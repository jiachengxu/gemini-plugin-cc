import { spawn, execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createWriteStream, readFileSync, unlinkSync } from 'node:fs';
import { normalizeEvent, parseLine } from './events.mjs';
import { ensureDir } from './fs.mjs';
import { dirname } from 'node:path';

// Max bytes for passing prompt via -p arg. Beyond this, use temp file + stdin.
const MAX_ARG_PROMPT_BYTES = 50_000;

/**
 * Abstract transport interface.
 * Concrete implementations handle communication with Gemini CLI.
 */
export class GeminiTransport {
  async invoke(_prompt, _options) {
    throw new Error('invoke() not implemented');
  }
  // eslint-disable-next-line require-yield
  async *stream(_prompt, _options) {
    throw new Error('stream() not implemented');
  }
  abort(_handle) {
    throw new Error('abort() not implemented');
  }
}

/**
 * Subprocess-based transport.
 * invoke() uses --output-format json (one-shot).
 * stream() uses --output-format stream-json (yields NormalizedEvents).
 *
 * Options:
 *   background: true → detach child process (for background jobs)
 *   stderrLogPath: path to write stderr output
 *   timeout: ms before kill
 *   model, approvalMode, resume, extraArgs, promptFile
 */
export class SubprocessTransport extends GeminiTransport {
  constructor(geminiPath = 'gemini') {
    super();
    this.geminiPath = geminiPath;
  }

  /**
   * One-shot invocation. Returns parsed JSON response.
   * Used for setup probes and simple queries (always foreground).
   */
  async invoke(prompt, options = {}) {
    const { args, promptViaStdin, promptText } = this._buildArgs(prompt, {
      ...options,
      outputFormat: 'json',
    });
    const { timeout } = options;

    return new Promise((resolve, reject) => {
      const child = spawn(this.geminiPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let timer;

      if (timeout) {
        timer = setTimeout(() => {
          timedOut = true;
          this._killChild(child, false);
        }, timeout);
        timer.unref();
      }

      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        this._cleanupPromptFile(options);
        if (timedOut) {
          reject(new Error(`Gemini CLI timed out after ${timeout}ms`));
          return;
        }
        if (code !== 0) {
          reject(new Error(`Gemini CLI exited with code ${code}: ${stderr.trim()}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({ response: stdout.trim(), raw: true });
        }
      });

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        this._cleanupPromptFile(options);
        reject(err);
      });

      // Write prompt via stdin if too large for argv
      if (promptViaStdin && promptText) {
        child.stdin.on('error', () => {}); // suppress EPIPE
        child.stdin.write(promptText);
      }
      child.stdin.end();
    });
  }

  /**
   * Streaming invocation. Yields NormalizedEvent objects.
   *
   * options.background: if true, detach process (for background workers)
   * options.stderrLogPath: write stderr to file for diagnostics
   */
  stream(prompt, options = {}) {
    const { args, promptViaStdin, promptText } = this._buildArgs(prompt, {
      ...options,
      outputFormat: 'stream-json',
    });

    const detach = !!options.background;
    const child = spawn(this.geminiPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: detach,
    });

    // Register foreground cleanup: kill child on parent exit
    let cleanupHandler;
    if (!detach) {
      cleanupHandler = () => {
        this._killChild(child, false);
      };
      process.on('exit', cleanupHandler);
      process.on('SIGINT', cleanupHandler);
      process.on('SIGTERM', cleanupHandler);
    }

    // Capture stderr to file if path provided
    if (options.stderrLogPath) {
      ensureDir(dirname(options.stderrLogPath));
      const stderrStream = createWriteStream(options.stderrLogPath);
      child.stderr.pipe(stderrStream);
    }

    // Write prompt via stdin if too large for argv
    if (promptViaStdin && promptText) {
      child.stdin.on('error', () => {}); // suppress EPIPE
      child.stdin.write(promptText);
    }
    child.stdin.end();

    const handle = {
      pid: child.pid,
      pgid: detach ? child.pid : null,
      child,
      stderrLogPath: options.stderrLogPath ?? null,
      detached: detach,
      cleanupHandler,
    };

    const { timeout } = options;
    const generator = this._streamEvents(child, timeout, handle, options);
    generator.handle = handle;

    return generator;
  }

  /**
   * Abort a running process by handle.
   */
  abort(handle) {
    if (handle?.child && !handle.child.killed) {
      this._killChild(handle.child, handle.detached);
    }
  }

  async *_streamEvents(child, timeout, handle, options) {
    const rl = createInterface({ input: child.stdout });
    let timedOut = false;
    let timer;

    // Handle stream errors (broken pipe, premature close, etc.)
    child.stdout.on('error', () => {});
    child.stderr?.on('error', () => {}); // suppress stderr errors

    if (timeout) {
      timer = setTimeout(() => {
        timedOut = true;
        this._killChild(child, handle.detached);
      }, timeout);
      timer.unref();
    }

    try {
      for await (const line of rl) {
        const raw = parseLine(line);
        if (raw) {
          yield normalizeEvent(raw);
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
      // Remove foreground signal handlers
      if (handle.cleanupHandler) {
        process.removeListener('exit', handle.cleanupHandler);
        process.removeListener('SIGINT', handle.cleanupHandler);
        process.removeListener('SIGTERM', handle.cleanupHandler);
      }
      this._cleanupPromptFile(options);
    }

    // Wait for process exit
    const exitCode = await new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve(child.exitCode);
      } else {
        child.on('close', resolve);
      }
    });

    handle.exitCode = exitCode;

    if (timedOut) {
      throw new Error(
        `Gemini CLI timed out after ${timeout}ms. Auth may have expired — run /gemini:setup`,
      );
    }

    if (exitCode !== 0 && exitCode !== null) {
      let stderrContent = '';
      if (handle.stderrLogPath) {
        try {
          stderrContent = readFileSync(handle.stderrLogPath, 'utf8').trim();
        } catch {}
      }
      const detail = stderrContent ? `: ${stderrContent.slice(0, 500)}` : '';
      throw new Error(`Gemini CLI exited with code ${exitCode}${detail}`);
    }
  }

  /**
   * Build CLI args. For large prompts, sets up stdin piping instead of -p arg.
   * Gemini CLI reads from stdin when -p is not provided.
   * Returns { args, promptViaStdin, promptText }.
   */
  _buildArgs(prompt, options = {}) {
    const args = [];

    // Resolve prompt text
    const promptText = options.promptFile
      ? readFileSync(options.promptFile, 'utf8')
      : (prompt ?? '');

    // Small prompts → -p arg. Large prompts → pipe via stdin (no -p).
    const promptBytes = Buffer.byteLength(promptText);
    const promptViaStdin = promptText.length > 0 && promptBytes > MAX_ARG_PROMPT_BYTES;

    if (promptText && !promptViaStdin) {
      args.push('-p', promptText);
    }
    // When promptViaStdin=true, caller pipes promptText to child.stdin

    if (options.outputFormat) {
      args.push('--output-format', options.outputFormat);
    }
    if (options.model) {
      args.push('-m', options.model);
    }
    if (options.approvalMode) {
      args.push('--approval-mode', options.approvalMode);
    }
    if (options.resume) {
      args.push('--resume', options.resume);
    }

    if (options.extraArgs?.length) {
      args.push(...options.extraArgs);
    }

    return { args, promptViaStdin, promptText: promptViaStdin ? promptText : '' };
  }

  _cleanupPromptFile(options) {
    if (options?._tmpPromptFile) {
      try {
        unlinkSync(options._tmpPromptFile);
      } catch {}
    }
  }

  _killChild(child, detached) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /T /F /PID ${child.pid}`, { stdio: 'pipe' });
      } else if (detached) {
        // Kill process group
        process.kill(-child.pid, 'SIGTERM');
        const escalation = setTimeout(() => {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {}
        }, 5000);
        escalation.unref();
      } else {
        // Kill just the child
        child.kill('SIGTERM');
        const escalation = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {}
        }, 5000);
        escalation.unref();
      }
    } catch {}
  }
}
