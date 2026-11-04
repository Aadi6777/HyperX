import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { app, server } from '../src/server.js';
import WebSocket from 'ws';

const BASE_URL = 'http://localhost:8080';

test('HyperX Backend API Test Suite', async (t) => {
  await t.test('GET /api/v1/health returns 200 OK and database status', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'UP');
    assert(data.service.includes('HyperX'));
    assert(data.database.includes('CONNECTED'));
  });

  await t.test('POST /api/v1/auth/register creates user account', async () => {
    const email = `test.${Date.now()}@hyperx.io`;
    const res = await fetch(`${BASE_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'TestPassword123!',
        fullName: 'Test Suite Runner'
      })
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert(data.token);
    assert.strictEqual(data.user.email, email);
  });

  await t.test('POST /api/v1/rooms creates a collaboration room with code', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Unit Test Room',
        code: 'TEST' + Math.floor(Math.random() * 900 + 100)
      })
    });
    assert.strictEqual(res.status, 201);
    const room = await res.json();
    assert(room.code);
    assert.strictEqual(room.name, 'Unit Test Room');
  });

  await t.test('GET and POST /api/v1/crdt/:roomId syncs collaborative scratchpad', async () => {
    const roomId = 'TEST_CRDT_' + Date.now();
    const postRes = await fetch(`${BASE_URL}/api/v1/crdt/${roomId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Initial CRDT State from Unit Test',
        title: 'Unit Test Doc'
      })
    });
    assert.strictEqual(postRes.status, 200);

    const getRes = await fetch(`${BASE_URL}/api/v1/crdt/${roomId}`);
    assert.strictEqual(getRes.status, 200);
    const doc = await getRes.json();
    assert.strictEqual(doc.content, 'Initial CRDT State from Unit Test');
  });

  await t.test('WebSocket Signaling /ws/signaling accepts peer connection and ping', async () => {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://localhost:8080/ws/signaling');
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket timed out'));
      }, 3000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'ping' }));
      });

      ws.on('message', (msg) => {
        const parsed = JSON.parse(msg.toString());
        if (parsed.type === 'pong') {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });
});
