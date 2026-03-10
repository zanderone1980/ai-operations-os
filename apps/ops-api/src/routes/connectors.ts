/**
 * Connector Status Routes — Reports which connectors are configured and connected.
 *
 * GET  /api/connectors   List all connectors with their status
 */

import { pathToRoute, sendJson } from '../server';
import type { Route } from '../server';
import { getGoogleAccessToken } from './oauth';

interface ConnectorStatus {
  id: string;
  name: string;
  configured: boolean;
  connected: boolean;
}

async function listConnectors(ctx: any): Promise<void> {
  const { res } = ctx;

  const googleToken = await getGoogleAccessToken();

  const connectors: ConnectorStatus[] = [
    {
      id: 'gmail',
      name: 'Gmail',
      configured: !!(process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID),
      connected: !!googleToken,
    },
    {
      id: 'calendar',
      name: 'Google Calendar',
      configured: !!(process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID),
      connected: !!googleToken,
    },
    {
      id: 'x-twitter',
      name: 'X/Twitter',
      configured: !!process.env.X_API_KEY,
      connected: !!process.env.X_API_KEY,
    },
    {
      id: 'shopify',
      name: 'Shopify',
      configured: !!(process.env.SHOPIFY_STORE_URL && process.env.SHOPIFY_ACCESS_TOKEN),
      connected: !!(process.env.SHOPIFY_STORE_URL && process.env.SHOPIFY_ACCESS_TOKEN),
    },
  ];

  sendJson(res, 200, { connectors });
}

export const connectorRoutes: Route[] = [
  pathToRoute('GET', '/api/connectors', listConnectors),
];
