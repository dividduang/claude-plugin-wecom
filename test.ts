#!/usr/bin/env bun
/**
 * Test script for WeCom plugin - simulates MCP client
 */

import { spawn } from 'child_process';
import { WebSocket } from 'ws';

// Start the server
const server = spawn('bun', ['server.ts'], {
  cwd: import.meta.dir,
  stdio: ['pipe', 'pipe', 'pipe']
});

let buffer = '';

server.stdout.on('data', (data) => {
  const output = data.toString();
  console.log('[STDOUT]', output);
});

server.stderr.on('data', (data) => {
  console.log('[STDERR]', data.toString());
});

server.on('close', (code) => {
  console.log(`Server exited with code ${code}`);
  process.exit(code || 0);
});

// Keep stdin open
process.stdin.on('data', (data) => {
  server.stdin.write(data);
});

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.kill();
  process.exit(0);
});

console.log('WeCom test client started. Press Ctrl+C to exit.');
console.log('Waiting for WebSocket connection and messages...');
console.log('You can send a message from WeCom now!\n');
