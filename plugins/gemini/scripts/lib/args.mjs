/**
 * Parse CLI arguments from process.argv (or provided array).
 * Extracts known flags and returns { flags, positional, raw }.
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {
    model: null,
    background: false,
    wait: false,
    resume: false,
    fresh: false,
    effort: null,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--model':
      case '-m':
        flags.model = argv[++i] ?? null;
        break;
      case '--background':
        flags.background = true;
        break;
      case '--wait':
        flags.wait = true;
        break;
      case '--resume':
        flags.resume = true;
        break;
      case '--fresh':
        flags.fresh = true;
        break;
      case '--effort':
        flags.effort = argv[++i] ?? null;
        break;
      default:
        positional.push(arg);
    }
  }

  return { flags, positional, raw: argv };
}

/**
 * Normalize model alias → full model name using alias table.
 */
export function resolveModel(nameOrAlias, aliases = {}) {
  if (!nameOrAlias) return null;
  return aliases[nameOrAlias] ?? nameOrAlias;
}
