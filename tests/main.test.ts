/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { mock, test } from 'node:test';
import assert from 'node:assert';

import { promises as fs } from 'fs';

import * as core from '@actions/core';
import { randomFilepath } from '@google-github-actions/actions-utils';
import * as path from 'path';

import { ClusterClient, ClusterResponse } from '../src/client';
import { run } from '../src/main';

const fakeInputs: { [key: string]: string } = {};

const defaultMocks = (
  m: typeof mock,
  overrideInputs?: Record<string, string>,
): Record<string, any> => {
  const inputs = Object.assign({}, fakeInputs, overrideInputs);
  return {
    setFailed: m.method(core, 'setFailed', (msg: string) => {
      throw new Error(msg);
    }),
    getBooleanInput: m.method(core, 'getBooleanInput', (name: string) => {
      return !!inputs[name];
    }),
    getMultilineInput: m.method(core, 'getMultilineInput', (name: string) => {
      return inputs[name];
    }),
    getInput: m.method(core, 'getInput', (name: string) => {
      return inputs[name];
    }),

    client: m.method(ClusterClient.prototype, 'getCluster', async (): Promise<ClusterResponse> => {
      return {
        data: {
          name: 'my-cluster',
          endpoint: 'https://foo.bar',
          masterAuth: {
            clusterCaCertificate: 'ca',
          },
          privateClusterConfig: {
            privateEndpoint: 'https://zip.zap',
          },
          controlPlaneEndpointsConfig: {
            dnsEndpointConfig: {
              endpoint: 'gke-123456789.us-central1.gke.goog',
            },
          },
        },
      };
    }),
  };
};

test('#run', { concurrency: true }, async (suite) => {
  const originalEnv = Object.assign({}, process.env);

  suite.before(() => {
    suite.mock.method(core, 'debug', () => {});
    suite.mock.method(core, 'info', () => {});
    suite.mock.method(core, 'warning', () => {});
    suite.mock.method(core, 'setOutput', () => {});
    suite.mock.method(core, 'setSecret', () => {});
    suite.mock.method(core, 'group', () => {});
    suite.mock.method(core, 'startGroup', () => {});
    suite.mock.method(core, 'endGroup', () => {});
    suite.mock.method(core, 'addPath', () => {});
  });

  suite.beforeEach(async () => {
    const pth = randomFilepath(path.join(__dirname, '..', 'tmp'));
    await fs.mkdir(pth, { recursive: true });
    process.env.GITHUB_WORKSPACE = pth;
  });

  suite.afterEach(async () => {
    await fs.rm(process.env.GITHUB_WORKSPACE!, {
      force: true,
      recursive: true,
    });
    process.env = Object.assign({}, originalEnv);
  });

  await suite.test('creates kubeconfig', async (t) => {
    defaultMocks(t.mock, {
      cluster_name: 'my-cluster',
      project_id: 'my-project',
      location: 'my-location',
    });

    const variableExports: Record<string, string> = {};
    t.mock.method(core, 'exportVariable', (k: string, v: string) => {
      variableExports[k] = v;
    });

    await run();

    const kubeconfig = variableExports.KUBECONFIG;
    const contents = await fs.readFile(kubeconfig, 'utf8');
    assert.ok(contents);

    if (process.platform !== 'win32') {
      const stats = await fs.stat(kubeconfig);
      assert.deepStrictEqual(stats.mode.toString(8), '100600');
    }
  });
});
