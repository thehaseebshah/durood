import { parentPort } from 'node:worker_threads';
import { audit } from './audit.js';

parentPort.postMessage(audit());
