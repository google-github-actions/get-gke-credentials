/*
 * Copyright 2020 Google LLC
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

import { test } from 'node:test';
import assert from 'node:assert';

import crypto from 'crypto';
import YAML from 'yaml';

import { ClusterClient, ClusterResponse, KubeConfig } from '../src/client';

import { skipIfMissingEnv } from '@google-github-actions/actions-utils';

const publicCluster: ClusterResponse = {
  name: 'public-cluster',
  endpoint: 'public-endpoint',
  masterAuth: {
    clusterCaCertificate: 'foo',
  },
  privateClusterConfig: {
    privateEndpoint: '',
  },
  controlPlaneEndpointsConfig: {
    dnsEndpointConfig: {
      endpoint: 'gke-123456789.us-central1.gke.goog',
    },
  },
};

const privateCluster: ClusterResponse = {
  name: 'private-cluster',
  endpoint: '',
  masterAuth: {
    clusterCaCertificate: 'foo',
  },
  privateClusterConfig: {
    privateEndpoint: 'private-endpoint',
  },
  controlPlaneEndpointsConfig: {
    dnsEndpointConfig: {
      endpoint: 'gke-123456789.us-central1.gke.goog',
    },
  },
};

test('.parseResourceName', { concurrency: true }, async (suite) => {
  const cases = [
    {
      name: 'empty string',
      input: '',
      error: 'Failed to parse cluster name',
    },
    {
      name: 'padded string',
      input: '  ',
      error: 'Failed to parse cluster name',
    },
    {
      name: 'single name',
      input: 'my-cluster',
      expected: {
        projectID: '',
        location: '',
        id: 'my-cluster',
      },
    },
    {
      name: 'full resource name',
      input: 'projects/p/locations/l/clusters/c',
      expected: {
        projectID: 'p',
        location: 'l',
        id: 'c',
      },
    },
    {
      name: 'partial resource name',
      input: 'projects/p/locations',
      error: 'Failed to parse cluster name',
    },
  ];

  for await (const tc of cases) {
    await suite.test(tc.name, async () => {
      if (tc.error) {
        assert.throws(() => {
          ClusterClient.parseResourceName(tc.input);
        }, tc.error);
      } else {
        const result = ClusterClient.parseResourceName(tc.input);
        assert.deepStrictEqual(result, tc.expected);
      }
    });
  }
});

test('.parseMembershipName', { concurrency: true }, async (suite) => {
  const cases = [
    {
      name: 'empty string',
      input: '',
      error: 'Failed to parse membership name',
    },
    {
      name: 'padded string',
      input: '  ',
      error: 'Failed to parse membership name',
    },
    {
      name: 'single name',
      input: 'my-membership',
      error: 'Failed to parse membership name',
    },
    {
      name: 'full resource name',
      input: 'projects/p/locations/l/memberships/m',
      expected: {
        projectID: 'p',
        location: 'l',
        membershipName: 'm',
      },
    },
    {
      name: 'partial resource name',
      input: 'projects/p/locations',
      error: 'Failed to parse membership name',
    },
  ];

  for await (const tc of cases) {
    await suite.test(tc.name, async () => {
      if (tc.error) {
        assert.throws(() => {
          ClusterClient.parseMembershipName(tc.input);
        }, tc.error);
      } else {
        const result = ClusterClient.parseMembershipName(tc.input);
        assert.deepStrictEqual(result, tc.expected);
      }
    });
  }
});

test(
  '#getToken',
  {
    concurrency: true,
    skip: skipIfMissingEnv('TEST_PROJECT_ID', 'TEST_CLUSTER_NAME', 'TEST_CLUSTER_LOCATION'),
  },
  async (suite) => {
    await suite.test('can get token', async () => {
      const testProjectID = process.env.TEST_PROJECT_ID!;
      const testClusterLocation = process.env.TEST_CLUSTER_LOCATION!;

      const client = new ClusterClient({
        projectID: testProjectID,
        location: testClusterLocation,
      });

      const token = await client.getToken();
      assert.ok(token);
    });
  },
);

test(
  '#getCluster',
  {
    concurrency: true,
    skip: skipIfMissingEnv('TEST_PROJECT_ID', 'TEST_CLUSTER_NAME', 'TEST_CLUSTER_LOCATION'),
  },
  async (suite) => {
    const testProjectID = process.env.TEST_PROJECT_ID!;
    const testClusterName = process.env.TEST_CLUSTER_NAME!;
    const testClusterLocation = process.env.TEST_CLUSTER_LOCATION!;

    await suite.test('can get cluster', async () => {
      const client = new ClusterClient({
        projectID: testProjectID,
        location: testClusterLocation,
      });

      const result = await client.getCluster(testClusterName);
      assert.ok('endpoint' in result);
      assert.ok('clusterCaCertificate' in result.masterAuth);
    });

    await suite.test('can get cluster by full resource name', async () => {
      const resourceName = `projects/${testProjectID}/locations/${testClusterLocation}/clusters/${testClusterName}`;
      const client = new ClusterClient();

      const result = await client.getCluster(resourceName);
      assert.ok('endpoint' in result);
      assert.ok('clusterCaCertificate' in result.masterAuth);
    });
  },
);

test('#discoverClusterMembership', { concurrency: true }, async (suite) => {
  const cases = [
    {
      name: 'valid',
      resp: {
        resources: [
          {
            name: 'membershipName',
          },
        ],
      },
      expected: 'membershipName',
    },
    {
      name: 'empty',
      resp: {
        resources: [],
      },
      error: 'expected one membership for projects/p/locations/l/clusters/c in foo. Found none.',
    },
    {
      name: 'multiple',
      resp: {
        resources: [
          {
            name: 'membershipName1',
          },
          {
            name: 'membershipName2',
          },
        ],
      },
      error:
        'expected one membership for projects/p/locations/l/clusters/c in foo. Found multiple memberships membershipName1,membershipName2.',
    },
  ];

  for await (const tc of cases) {
    await suite.test(tc.name, async (t) => {
      const client = new ClusterClient({ projectID: 'foo' });

      t.mock.method(client.auth, 'request', async () => {
        return { data: tc.resp };
      });

      if (tc.error) {
        await assert.rejects(async () => {
          await client.discoverClusterMembership('projects/p/locations/l/clusters/c');
        }, tc.error);
      } else {
        const result = await client.discoverClusterMembership('projects/p/locations/l/clusters/c');
        assert.deepStrictEqual(result, tc.expected);
      }
    });
  }
});

test('#projectIDtoNum', { concurrency: true }, async (suite) => {
  const cases = [
    {
      name: 'valid',
      projectID: 'foo',
      resp: { name: 'projects/123' },
      expected: '123',
    },
    {
      name: 'invalid resp',
      projectID: 'bar',
      resp: { name: 'bar' },
      error: 'failed to parse project number: expected format projects/PROJECT_NUMBER. Got bar',
    },
  ];

  for await (const tc of cases) {
    await suite.test(tc.name, async (t) => {
      const client = new ClusterClient();

      t.mock.method(client.auth, 'request', async () => {
        return { data: tc.resp };
      });

      if (tc.error) {
        await assert.rejects(async () => {
          await client.projectIDtoNum(tc.projectID);
        }, tc.error);
      } else {
        const result = await client.projectIDtoNum(tc.projectID);
        assert.deepStrictEqual(result, tc.expected);
      }
    });
  }
});

test(
  '#createKubeConfig',
  {
    concurrency: true,
    skip: skipIfMissingEnv('TEST_PROJECT_ID', 'TEST_CLUSTER_NAME', 'TEST_CLUSTER_LOCATION'),
  },
  async (suite) => {
    const testProjectID = process.env.TEST_PROJECT_ID!;
    const testClusterLocation = process.env.TEST_CLUSTER_LOCATION!;

    await suite.test('can get generate kubeconfig with token for public clusters', async () => {
      const contextName = crypto.randomBytes(12).toString('hex');
      const client = new ClusterClient({
        projectID: testProjectID,
        location: testClusterLocation,
      });
      const kubeconfig = YAML.parse(
        await client.createKubeConfig({
          useAuthProvider: false,
          useInternalIP: false,
          useDNSBasedEndpoint: false,
          clusterData: publicCluster,
          contextName: contextName,
        }),
      );

      const cluster = kubeconfig.clusters?.at(0);
      const user = kubeconfig.users?.at(0);

      assert.deepStrictEqual(kubeconfig?.['current-context'], contextName);

      assert.deepStrictEqual(cluster?.name, publicCluster?.name);
      assert.deepStrictEqual(
        cluster?.cluster?.['certificate-authority-data'],
        publicCluster.masterAuth?.clusterCaCertificate,
      );
      assert.deepStrictEqual(cluster?.cluster?.server, `https://${publicCluster?.endpoint}`);

      assert.deepStrictEqual(user?.name, publicCluster?.name);
      assert.ok(user?.user?.token);
    });

    await suite.test(
      'can get generate kubeconfig with auth plugin for public clusters',
      async () => {
        const contextName = crypto.randomBytes(12).toString('hex');
        const client = new ClusterClient({
          projectID: testProjectID,
          location: testClusterLocation,
        });
        const kubeconfig: KubeConfig = YAML.parse(
          await client.createKubeConfig({
            useAuthProvider: true,
            useInternalIP: false,
            useDNSBasedEndpoint: false,
            clusterData: publicCluster,
            contextName: contextName,
          }),
        );

        const cluster = kubeconfig.clusters?.at(0);
        const user = kubeconfig.users?.at(0);

        assert.deepStrictEqual(kubeconfig?.['current-context'], contextName);

        assert.deepStrictEqual(cluster?.name, publicCluster?.name);
        assert.deepStrictEqual(
          cluster?.cluster?.['certificate-authority-data'],
          publicCluster.masterAuth?.clusterCaCertificate,
        );
        assert.deepStrictEqual(cluster?.cluster?.server, `https://${publicCluster?.endpoint}`);

        assert.deepStrictEqual(user?.name, publicCluster?.name);
        assert.deepStrictEqual(user?.user?.['auth-provider']?.name, 'gcp');
      },
    );

    await suite.test('can get generate kubeconfig with token for private clusters', async () => {
      const contextName = crypto.randomBytes(12).toString('hex');
      const client = new ClusterClient({
        projectID: testProjectID,
        location: testClusterLocation,
      });
      const kubeconfig: KubeConfig = YAML.parse(
        await client.createKubeConfig({
          useAuthProvider: false,
          useInternalIP: true,
          useDNSBasedEndpoint: false,
          clusterData: privateCluster,
          contextName: contextName,
        }),
      );

      const cluster = kubeconfig.clusters?.at(0);
      const user = kubeconfig.users?.at(0);

      assert.deepStrictEqual(kubeconfig?.['current-context'], contextName);

      assert.deepStrictEqual(cluster?.name, privateCluster?.name);
      assert.deepStrictEqual(
        cluster?.cluster?.['certificate-authority-data'],
        privateCluster.masterAuth?.clusterCaCertificate,
      );
      assert.deepStrictEqual(
        cluster?.cluster?.server,
        `https://${privateCluster?.privateClusterConfig?.privateEndpoint}`,
      );

      assert.deepStrictEqual(user?.name, privateCluster?.name);
    });

    await suite.test('can generate kubeconfig with connect gateway', async () => {
      const contextName = crypto.randomBytes(12).toString('hex');
      const client = new ClusterClient({
        projectID: testProjectID,
        location: testClusterLocation,
      });
      const kubeconfig: KubeConfig = YAML.parse(
        await client.createKubeConfig({
          useAuthProvider: false,
          useInternalIP: false,
          useDNSBasedEndpoint: false,
          connectGWEndpoint: 'foo',
          clusterData: privateCluster,
          contextName: contextName,
        }),
      );

      const cluster = kubeconfig.clusters?.at(0);

      assert.deepStrictEqual(kubeconfig?.['current-context'], contextName);

      assert.deepStrictEqual(cluster?.name, privateCluster.name);
      assert.deepStrictEqual(cluster?.cluster.server, 'https://foo');
    });

    await suite.test('can generate kubeconfig with DNS-based endpoint', async () => {
      const contextName = crypto.randomBytes(12).toString('hex');
      const client = new ClusterClient({
        projectID: testProjectID,
        location: testClusterLocation,
      });
      const kubeconfig: KubeConfig = YAML.parse(
        await client.createKubeConfig({
          useAuthProvider: false,
          useInternalIP: false,
          useDNSBasedEndpoint: true,
          clusterData: privateCluster,
          contextName: contextName,
        }),
      );

      const cluster = kubeconfig.clusters?.at(0);

      assert.deepStrictEqual(kubeconfig?.['current-context'], contextName);

      assert.deepStrictEqual(cluster?.name, privateCluster.name);
      assert.deepStrictEqual(cluster?.cluster.server, 'https://gke-123456789.us-central1.gke.goog');
    });

    await suite.test('can set a namespace=', async () => {
      const contextName = crypto.randomBytes(12).toString('hex');
      const client = new ClusterClient({
        projectID: testProjectID,
        location: testClusterLocation,
      });
      const kubeconfig: KubeConfig = YAML.parse(
        await client.createKubeConfig({
          useAuthProvider: false,
          useInternalIP: false,
          useDNSBasedEndpoint: false,
          clusterData: privateCluster,
          contextName: contextName,
          namespace: 'my-namespace',
        }),
      );

      const context = kubeconfig?.contexts?.at(0)?.context;
      assert.deepStrictEqual(context?.namespace, 'my-namespace');
    });
  },
);
