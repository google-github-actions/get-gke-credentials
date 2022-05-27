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

import { expect } from 'chai';
import 'mocha';

import crypto from 'crypto';

import { errorMessage, parseCredential } from '@google-github-actions/actions-utils';
import YAML from 'yaml';
import * as sinon from 'sinon';
import { GaxiosResponse } from 'gaxios';

const credentials = process.env.GET_GKE_CRED_SA_KEY_JSON;
const project = process.env.GET_GKE_CRED_PROJECT;
const name = process.env.GET_GKE_CRED_CLUSTER_NAME;
const location = process.env.GKE_AUTH_CLUSTER_LOCATION || 'us-central1-a';

const publicCluster: ClusterResponse = {
  data: {
    name: 'public-cluster',
    endpoint: 'public-endpoint',
    masterAuth: {
      clusterCaCertificate: 'foo',
    },
    privateClusterConfig: {
      privateEndpoint: '',
    },
  },
};

const privateCluster: ClusterResponse = {
  data: {
    name: 'private-cluster',
    endpoint: '',
    masterAuth: {
      clusterCaCertificate: 'foo',
    },
    privateClusterConfig: {
      privateEndpoint: 'private-endpoint',
    },
  },
};

import { ClusterClient, ClusterResponse } from '../src/gkeClient';

describe('Cluster', function () {
  afterEach(() => {
    sinon.restore();
  });

  describe('.parseResourceName', () => {
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

    cases.forEach((tc) => {
      it(tc.name, async () => {
        if (tc.expected) {
          expect(ClusterClient.parseResourceName(tc.input)).to.eql(tc.expected);
        } else if (tc.error) {
          expect(() => {
            ClusterClient.parseResourceName(tc.input);
          }).to.throw(tc.error);
        }
      });
    });
  });

  describe('.parseMembershipName', () => {
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

    cases.forEach((tc) => {
      it(tc.name, async () => {
        if (tc.expected) {
          expect(ClusterClient.parseMembershipName(tc.input)).to.eql(tc.expected);
        } else if (tc.error) {
          expect(() => {
            ClusterClient.parseMembershipName(tc.input);
          }).to.throw(tc.error);
        }
      });
    });
  });

  it('initializes with ADC', async function () {
    if (!process.env.GCLOUD_PROJECT) this.skip();

    const client = new ClusterClient({ location: location });
    expect(client.auth.jsonContent).eql(null);
    expect(await client.getToken()).to.be;
  });

  it('can get cluster', async function () {
    if (!credentials || !name) this.skip();

    const client = new ClusterClient({
      projectID: project,
      location: location,
      credentials: parseCredential(credentials),
    });
    const result = await client.getCluster(name);

    expect(result).to.not.eql(null);
    expect(result.data.endpoint).to.not.be.null;
    expect(result.data.masterAuth.clusterCaCertificate).to.not.be.null;
  });

  it('can get cluster by full resource name', async function () {
    if (!credentials || !name) this.skip();

    const resourceName = `projects/${project}/locations/${location}/clusters/${name}`;
    const client = new ClusterClient({
      credentials: parseCredential(credentials),
    });
    const result = await client.getCluster(resourceName);

    expect(result).to.not.eql(null);
    expect(result.data.endpoint).to.not.be.null;
    expect(result.data.masterAuth.clusterCaCertificate).to.not.be.null;
  });

  describe('.discoverClusterMembership', () => {
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
    const client = new ClusterClient({ projectID: 'foo' });
    cases.forEach((tc) => {
      it(tc.name, async () => {
        sinon.stub(client.auth, 'request').resolves({ data: tc.resp } as GaxiosResponse);
        if (tc.expected) {
          const projectNum = await client.discoverClusterMembership(
            'projects/p/locations/l/clusters/c',
          );
          expect(projectNum).to.eql(tc.expected);
        } else if (tc.error) {
          try {
            await client.discoverClusterMembership('projects/p/locations/l/clusters/c');
          } catch (err: unknown) {
            const msg = errorMessage(err);
            expect(msg).to.include(tc.error);
          }
        }
      });
    });
  });

  describe('.getProjectNumFromID', () => {
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
    const client = new ClusterClient({});
    cases.forEach((tc) => {
      it(tc.name, async () => {
        sinon.stub(client.auth, 'request').resolves({ data: tc.resp } as GaxiosResponse);
        if (tc.expected) {
          const projectNum = await client.projectIDtoNum(tc.projectID);
          expect(projectNum).to.eql(tc.expected);
        } else if (tc.error) {
          try {
            await client.projectIDtoNum(tc.projectID);
          } catch (err: unknown) {
            const msg = errorMessage(err);
            expect(msg).to.include(tc.error);
          }
        }
      });
    });
  });

  it('can get token', async function () {
    if (!credentials) this.skip();

    const client = new ClusterClient({
      projectID: project,
      location: location,
      credentials: parseCredential(credentials),
    });
    const token = await client.getToken();

    expect(token).to.not.eql(null);
  });

  it('can get generate kubeconfig with token for public clusters', async function () {
    if (!credentials) this.skip();

    const contextName = crypto.randomBytes(12).toString('hex');
    const client = new ClusterClient({
      projectID: project,
      location: location,
      credentials: parseCredential(credentials),
    });
    const kubeconfig = YAML.parse(
      await client.createKubeConfig({
        useAuthProvider: false,
        useInternalIP: false,
        clusterData: publicCluster,
        contextName: contextName,
      }),
    );

    expect(kubeconfig.clusters[0].name).to.eql(publicCluster.data.name);
    expect(kubeconfig.clusters[0].cluster['certificate-authority-data']).to.eql(
      publicCluster.data.masterAuth.clusterCaCertificate,
    );
    expect(kubeconfig.clusters[0].cluster.server).to.eql(`https://${publicCluster.data.endpoint}`);
    expect(kubeconfig['current-context']).to.eql(contextName);
    expect(kubeconfig.users[0].name).to.eql(publicCluster.data.name);
    expect(kubeconfig.users[0].user.token).to.be.not.null;
    expect(kubeconfig.users[0].user).to.not.have.property('auth-provider');
  });

  it('can get generate kubeconfig with auth plugin for public clusters', async function () {
    if (!credentials) this.skip();

    const contextName = crypto.randomBytes(12).toString('hex');
    const client = new ClusterClient({
      projectID: project,
      location: location,
      credentials: parseCredential(credentials),
    });
    const kubeconfig = YAML.parse(
      await client.createKubeConfig({
        useAuthProvider: true,
        useInternalIP: false,
        clusterData: publicCluster,
        contextName: contextName,
      }),
    );

    expect(kubeconfig.clusters[0].name).to.eql(publicCluster.data.name);
    expect(kubeconfig.clusters[0].cluster['certificate-authority-data']).to.eql(
      publicCluster.data.masterAuth.clusterCaCertificate,
    );
    expect(kubeconfig.clusters[0].cluster.server).to.eql(`https://${publicCluster.data.endpoint}`);
    expect(kubeconfig['current-context']).to.eql(contextName);
    expect(kubeconfig.users[0].name).to.eql(publicCluster.data.name);
    expect(kubeconfig.users[0].user['auth-provider'].name).to.eql('gcp');
    expect(kubeconfig.users[0].user).to.not.have.property('token');
  });

  it('can get generate kubeconfig with token for private clusters', async function () {
    if (!credentials) this.skip();

    const contextName = crypto.randomBytes(12).toString('hex');
    const client = new ClusterClient({
      projectID: project,
      location: location,
      credentials: parseCredential(credentials),
    });
    const kubeconfig = YAML.parse(
      await client.createKubeConfig({
        useAuthProvider: false,
        useInternalIP: true,
        clusterData: privateCluster,
        contextName: contextName,
      }),
    );

    expect(kubeconfig.clusters[0].name).to.eql(privateCluster.data.name);
    expect(kubeconfig.clusters[0].cluster['certificate-authority-data']).to.eql(
      privateCluster.data.masterAuth.clusterCaCertificate,
    );
    expect(kubeconfig.clusters[0].cluster.server).to.eql(
      `https://${privateCluster.data.privateClusterConfig.privateEndpoint}`,
    );
    expect(kubeconfig['current-context']).to.eql(contextName);
    expect(kubeconfig.users[0].name).to.eql(privateCluster.data.name);
    expect(kubeconfig.users[0].user.token).to.be.not.null;
    expect(kubeconfig.users[0].user).to.not.have.property('auth-provider');
  });

  it('can get generate kubeconfig with auth plugin for private clusters', async function () {
    if (!credentials) this.skip();

    const contextName = crypto.randomBytes(12).toString('hex');
    const client = new ClusterClient({
      projectID: project,
      location: location,
      credentials: parseCredential(credentials),
    });
    const kubeconfig = YAML.parse(
      await client.createKubeConfig({
        useAuthProvider: true,
        useInternalIP: true,
        clusterData: privateCluster,
        contextName: contextName,
      }),
    );

    expect(kubeconfig.clusters[0].name).to.eql(privateCluster.data.name);
    expect(kubeconfig.clusters[0].cluster['certificate-authority-data']).to.eql(
      privateCluster.data.masterAuth.clusterCaCertificate,
    );
    expect(kubeconfig.clusters[0].cluster.server).to.eql(
      `https://${privateCluster.data.privateClusterConfig.privateEndpoint}`,
    );
    expect(kubeconfig['current-context']).to.eql(contextName);
    expect(kubeconfig.users[0].name).to.eql(privateCluster.data.name);
    expect(kubeconfig.users[0].user['auth-provider'].name).to.eql('gcp');
    expect(kubeconfig.users[0].user).to.not.have.property('token');
  });

  it('can generate kubeconfig with connect gateway', async function () {
    if (!credentials) this.skip();

    const contextName = crypto.randomBytes(12).toString('hex');
    const client = new ClusterClient({
      projectID: project,
      location: location,
      credentials: parseCredential(credentials),
    });
    const kubeconfig = YAML.parse(
      await client.createKubeConfig({
        useAuthProvider: false,
        useInternalIP: false,
        connectGWEndpoint: 'foo',
        clusterData: privateCluster,
        contextName: contextName,
      }),
    );

    expect(kubeconfig.clusters[0].name).to.eql(privateCluster.data.name);
    expect(kubeconfig.clusters[0].cluster['certificate-authority-data']).to.not.exist;
    expect(kubeconfig.clusters[0].cluster.server).to.eql(`https://foo`);
    expect(kubeconfig['current-context']).to.eql(contextName);
    expect(kubeconfig.users[0].name).to.eql(privateCluster.data.name);
    expect(kubeconfig.users[0].user).to.not.have.property('auth-provider');
    expect(kubeconfig.users[0].user).to.have.property('token');
  });
});
