/**
 * health command — Check API server health status.
 *
 * Usage: ai-ops health [--url URL]
 */

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

export async function health(url: string = 'http://localhost:3100'): Promise<void> {
  const endpoint = `${url}/health`;
  console.log(`${c.dim}Checking ${endpoint}...${c.reset}`);
  console.log();

  try {
    const res = await fetch(endpoint);

    if (!res.ok) {
      console.log(`${c.red}${c.bold}UNHEALTHY${c.reset}  HTTP ${res.status}`);
      const body = await res.text();
      if (body) console.log(`  ${c.dim}${body}${c.reset}`);
      process.exitCode = 1;
      return;
    }

    const data = (await res.json()) as Record<string, unknown>;

    console.log(`${c.green}${c.bold}HEALTHY${c.reset}`);
    console.log();

    if (data.version) {
      console.log(`  ${c.bold}Version:${c.reset}      ${data.version}`);
    }
    if (data.uptime !== undefined) {
      const uptimeSec = Number(data.uptime);
      const hours = Math.floor(uptimeSec / 3600);
      const mins = Math.floor((uptimeSec % 3600) / 60);
      const secs = Math.floor(uptimeSec % 60);
      console.log(`  ${c.bold}Uptime:${c.reset}       ${hours}h ${mins}m ${secs}s`);
    }
    if (data.routes !== undefined) {
      console.log(`  ${c.bold}Route Count:${c.reset}  ${data.routes}`);
    }
    if (data.routeCount !== undefined) {
      console.log(`  ${c.bold}Route Count:${c.reset}  ${data.routeCount}`);
    }

    // Print any other fields generically
    const knownKeys = new Set(['version', 'uptime', 'routes', 'routeCount', 'status']);
    for (const [key, value] of Object.entries(data)) {
      if (!knownKeys.has(key)) {
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        console.log(`  ${c.bold}${label}:${c.reset}${' '.repeat(Math.max(1, 14 - label.length - 1))}${value}`);
      }
    }

    console.log();
  } catch (err) {
    console.log(`${c.red}${c.bold}UNREACHABLE${c.reset}  Could not connect to ${endpoint}`);
    console.log(`  ${c.dim}${(err as Error).message}${c.reset}`);
    console.log();
    console.log(`  ${c.yellow}Is the API server running?${c.reset}`);
    console.log(`  ${c.dim}Start it with: npm run dev --workspace=apps/ops-api${c.reset}`);
    process.exitCode = 1;
  }
}
