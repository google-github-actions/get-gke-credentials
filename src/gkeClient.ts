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

import { CredentialBody, ExternalAccountClientOptions, GoogleAuth } from 'google-auth-library';
import YAML from 'yaml';

// Do not listen to the linter - this can NOT be rewritten as an ES6 import statement.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: appVersion } = require('../package.json');

// clusterResourceNamePattern is the regular expression to use to match resource
// names.
const clusterResourceNamePattern = new RegExp(/^projects\/.+\/locations\/.+\/clusters\/.+$/gi);

/**
 * Available options to create the client.
 *
 * @param credentials GCP JSON credentials (default uses ADC).
 * @param endpoint GCP endpoint (useful for testing).
 */
type ClientOptions = {
  projectID?: string;
  location?: string;
  credentials?: CredentialBody | ExternalAccountClientOptions;
};

/**
 * Wraps interactions with the Google Cloud Cluster API.
 *
 * @param location Location of the GCP resource.
 * @param opts list of ClientOptions.
 * @returns Cluster client.
 */
export class ClusterClient {
  /**
   * projectID and location are hints to the client if a resource name does not
   * include the full resource name. If a full resource name is given (e.g.
   * `projects/p/locations/l/clusters/c`), then that is used. However, if just a
   * name is given (e.g. `c`), these values will be used to construct the full
   * resource name.
   */
  readonly #projectID?: string;
  readonly #location?: string;

  readonly defaultEndpoint = 'https://container.googleapis.com/v1';
  readonly userAgent = `github-actions-get-gke-credentials/${appVersion}`;
  readonly auth: GoogleAuth;

  constructor(opts: ClientOptions) {
    this.auth = new GoogleAuth({
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      credentials: opts?.credentials,
      projectId: opts?.projectID,
    });

    this.#projectID = opts?.projectID;
    this.#location = opts?.location;
  }

  /**
   * Retrieves the auth client for authenticating requests.
   *
   * @returns string
   */
  async getToken(): Promise<string> {
    const token = await this.auth.getAccessToken();
    if (!token) {
      throw new Error('Failed to generate token.');
    }
    return token;
  }

  /**
   * Generates full resource name.
   *
   * @param name cluster name.
   * @returns full resource name.
   */
  getResource(name: string): string {
    if (!name) {
      name = '';
    }

    name = name.trim();
    if (!name) {
      throw new Error(`Failed to parse resource name: name cannot be empty`);
    }

    if (name.includes('/')) {
      if (name.match(clusterResourceNamePattern)) {
        return name;
      } else {
        throw new Error(`Invalid resource name "${name}"`);
      }
    }

    const projectID = this.#projectID;
    if (!projectID) {
      throw new Error(`Failed to get project ID to build resource name. Try setting "project_id".`);
    }

    const location = this.#location;
    if (!location) {
      throw new Error(
        `Failed to get location (region/zone) to build resource name. Try setting "location".`,
      );
    }

    return `projects/${projectID}/locations/${location}/clusters/${name}`;
  }

  /**
   * Retrieves a Cluster.
   *
   * @param fqn Cluster name
   * @returns a Cluster object.
   */
  async getCluster(clusterName: string): Promise<ClusterResponse> {
    const url = `${this.defaultEndpoint}/${this.getResource(clusterName)}`;
    const resp = (await this.auth.request({
      url: url,
      headers: {
        'User-Agent': this.userAgent,
      },
    })) as ClusterResponse;
    return resp;
  }

  /**
   * Create kubeconfig for cluster.
   *
   * @param opts Input options. See CreateKubeConfigOptions.
   */
  async createKubeConfig(opts: CreateKubeConfigOptions): Promise<string> {
    const cluster = opts.clusterData;
    const endpoint = opts.useInternalIP
      ? cluster.data.privateClusterConfig.privateEndpoint
      : cluster.data.endpoint;
    const auth = opts.useAuthProvider
      ? { user: { 'auth-provider': { name: 'gcp' } } }
      : { user: { token: await this.getToken() } };
    const kubeConfig: KubeConfig = {
      'apiVersion': 'v1',
      'clusters': [
        {
          cluster: {
            'certificate-authority-data': cluster.data.masterAuth?.clusterCaCertificate,
            'server': `https://${endpoint}`,
          },
          name: cluster.data.name,
        },
      ],
      'contexts': [
        {
          context: {
            cluster: cluster.data.name,
            user: cluster.data.name,
          },
          name: cluster.data.name,
        },
      ],
      'kind': 'Config',
      'current-context': cluster.data.name,
      'users': [{ ...{ name: cluster.data.name }, ...auth }],
    };
    return YAML.stringify(kubeConfig);
  }
}

type cluster = {
  cluster: {
    'certificate-authority-data': string;
    'server': string;
  };
  name: string;
};

type context = {
  context: {
    cluster: string;
    user: string;
  };
  name: string;
};

export type CreateKubeConfigOptions = {
  // useAuthProvider is a boolean to use short lived OIDC token or GCP auth
  // plugin in kubectl.
  useAuthProvider: boolean;

  // useInternalIP is a boolean to use the internal IP address of the cluster
  // endpoint.
  useInternalIP: boolean;

  // clusterData is the cluster response data.
  clusterData: ClusterResponse;
};

export type KubeConfig = {
  'apiVersion': string;
  'clusters': cluster[];
  'contexts': context[];
  'current-context': string;
  'kind': string;
  'users': [
    {
      name: string;
      user: {
        'token'?: string;
        'auth-provider'?: { name: string };
      };
    },
  ];
};

export type ClusterResponse = {
  data: {
    name: string;
    endpoint: string;
    masterAuth: {
      clusterCaCertificate: string;
    };
    privateClusterConfig: {
      privateEndpoint: string;
    };
  };
};
