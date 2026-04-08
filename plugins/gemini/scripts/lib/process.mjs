import { execSync } from 'node:child_process';

/**
 * Kill a process tree by PGID (unix) or taskkill (windows).
 * SIGTERM first, escalate to SIGKILL after 5s.
 *
 * Safety: validates the PID is still a node/gemini process before killing
 * to avoid terminating an innocent process with a recycled PID.
 */
export function killProcessTree(pid) {
  if (!pid) return;

  // Verify the process is still ours before killing
  if (!isOurProcess(pid)) return;

  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'pipe' });
    } else {
      process.kill(-pid, 'SIGTERM');
      const escalation = setTimeout(() => {
        // Re-check before SIGKILL escalation
        if (isOurProcess(pid)) {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {}
        }
      }, 5000);
      escalation.unref();
    }
  } catch {}
}

/**
 * Check if a process is alive.
 */
export function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if PID belongs to a node/gemini process (not a recycled PID).
 * Platform-aware: uses `ps` on Unix, `wmic` on Windows.
 * Returns false if the process doesn't exist or isn't ours.
 */
function isOurProcess(pid) {
  if (!isProcessAlive(pid)) return false;
  try {
    let cmd;
    if (process.platform === 'win32') {
      cmd = execSync(`wmic process where processid=${pid} get name /format:value`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } else {
      cmd = execSync(`ps -o comm= -p ${pid}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    }
    return cmd.includes('node') || cmd.includes('gemini');
  } catch {
    // If we can't verify, assume it's not ours — safer than killing randomly
    return false;
  }
}
