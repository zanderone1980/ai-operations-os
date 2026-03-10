#!/usr/bin/env node
/**
 * ai-ops CLI — Entry point.
 *
 * Parses process.argv and routes to the appropriate command.
 *
 * Usage:
 *   ai-ops health [--url URL]     Check API server health
 *   ai-ops demo                   Load demo seed data
 *   ai-ops receipts verify        Verify receipt chain integrity
 *   ai-ops version                Print version
 *   ai-ops help                   Print usage
 */

import { health } from './commands/health';
import { demo } from './commands/demo';
import { receiptsVerify } from './commands/receipts';

const VERSION = '0.1.0';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
};

function printHelp(): void {
  console.log();
  console.log(`${c.bold}ai-ops${c.reset} — CLI for AI Operations OS`);
  console.log();
  console.log(`${c.bold}USAGE${c.reset}`);
  console.log(`  ai-ops <command> [options]`);
  console.log();
  console.log(`${c.bold}COMMANDS${c.reset}`);
  console.log(`  ${c.cyan}health${c.reset} [--url URL]     Check API server health status`);
  console.log(`                          Default URL: http://localhost:3100`);
  console.log(`  ${c.cyan}demo${c.reset}                   Load demo seed data into the database`);
  console.log(`  ${c.cyan}receipts verify${c.reset}        Verify receipt chain integrity`);
  console.log(`  ${c.cyan}version${c.reset}                Print CLI version`);
  console.log(`  ${c.cyan}help${c.reset}                   Print this usage information`);
  console.log();
  console.log(`${c.bold}EXAMPLES${c.reset}`);
  console.log(`  ${c.dim}$ ai-ops health${c.reset}`);
  console.log(`  ${c.dim}$ ai-ops health --url http://production.example.com:3100${c.reset}`);
  console.log(`  ${c.dim}$ ai-ops demo${c.reset}`);
  console.log(`  ${c.dim}$ ai-ops receipts verify${c.reset}`);
  console.log();
}

function printVersion(): void {
  console.log(`ai-ops v${VERSION}`);
}

function parseUrl(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      return args[i + 1];
    }
  }
  return 'http://localhost:3100';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'health':
      await health(parseUrl(args.slice(1)));
      break;

    case 'demo':
      await demo();
      break;

    case 'receipts': {
      const subcommand = args[1];
      if (subcommand === 'verify') {
        await receiptsVerify();
      } else {
        console.error(`Unknown receipts subcommand: ${subcommand ?? '(none)'}`);
        console.error(`Usage: ai-ops receipts verify`);
        process.exitCode = 1;
      }
      break;
    }

    case 'version':
    case '--version':
    case '-v':
      printVersion();
      break;

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error(`Run "ai-ops help" for usage information.`);
      process.exitCode = 1;
      break;
  }
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exitCode = 1;
});
