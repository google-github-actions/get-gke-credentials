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

import { presence } from '@google-github-actions/actions-utils';
import { GoogleAuth } from 'google-auth-library';
import { GaxiosOptions } from 'gaxios';
import YAML from 'yaml';

// Do not listen to the linter - this can NOT be rewritten as an ES6 import statement.
const { version: appVersion } = require('../package.json');

// userAgent is the user agent string.
const userAgent = `google-github-actions:get-gke-credentials/${appVersion}`;

// clusterResourceNamePattern is the regular expression to use to match resource
// names.
const clusterResourceNamePattern = new RegExp(/^projects\/(.+)\/locations\/(.+)\/clusters\/(.+)$/i);

// membershipResourceNamePattern is the regular expression to use to match fleet membership
// name.
const membershipResourceNamePattern = new RegExp(
  /^projects\/(.+)\/locations\/(.+)\/(?:gkeMemberships|memberships)\/(.+)$/i,
);

/**
 * Available options to create the client.
 *
 * @param projectID GCP project ID.
 * @param location Cluster location.
 */
type ClientOptions = {
  projectID?: string;
  quotaProjectID?: string;
  location?: string;
  logger?: Logger;
};

/**
 * Logger is the passed in logger on the client.
 */
type Logger = {
  debug: (message: string) => void; // eslint-disable-line no-unused-vars
  info: (message: string) => void; // eslint-disable-line no-unused-vars
  warn: (message: string) => void; // eslint-disable-line no-unused-vars
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
   * parseResourceName parses a string as a cluster resource name. If it's just
   * a cluster name, it returns an empty project ID and location. If a full
   * resource name is given, the values are parsed and returned. All other
   * inputs throw an error.
   *
   * @param name Name of the cluster (e.g. "my-cluster" or "projects/p/locations/l/clusters/c")
   */
  static parseResourceName(name: string): {
    projectID: string;
    location: string;
    id: string;
  } {
    name = (name || '').trim();
    if (!name) {
      throw new Error(`Failed to parse cluster name: value is the empty string`);
    }

    if (!name.includes('/')) {
      return {
        projectID: '',
        location: '',
        id: name,
      };
    }

    const matches = name.match(clusterResourceNamePattern);
    if (!matches) {
      throw new Error(`Failed to parse cluster name "${name}": invalid pattern`);
    }

    return {
      projectID: matches[1],
      location: matches[2],
      id: matches[3],
    };
  }

  /**
   * parseMembershipName parses a string as a Fleet membership name. A full
   * resource name is expected and the values are parsed and returned. All other
   * inputs throw an error.
   *
   * @param name Name of the fleet membership "projects/p/locations/l/memberships/m"
   */
  static parseMembershipName(name: string): {
    projectID: string;
    location: string;
    membershipName: string;
  } {
    name = (name || '').trim();
    if (!name) {
      throw new Error(`Failed to parse membership name: membership name cannot be empty`);
    }

    const matches = name.match(membershipResourceNamePattern);
    if (!matches) {
      throw new Error(
        `Failed to parse membership name "${name}": invalid pattern. Should be of form projects/PROJECT_ID/locations/LOCATION/gkeMemberships/MEMBERSHIP_NAME or projects/PROJECT_ID/locations/LOCATION/memberships/MEMBERSHIP_NAME`,
      );
    }
    return {
      projectID: matches[1],
      location: matches[2],
      membershipName: matches[3],
    };
  }

  /**
   * projectID and location are hints to the client if a resource name does not
   * include the full resource name. If a full resource name is given (e.g.
   * `projects/p/locations/l/clusters/c`), then that is used. However, if just a
   * name is given (e.g. `c`), these values will be used to construct the full
   * resource name.
   */
  readonly #logger?: Logger;
  readonly #projectID?: string;
  readonly #quotaProjectID?: string;
  readonly #location?: string;
  readonly #headers?: Record<string, string>;

  readonly defaultEndpoint = 'https://container.googleapis.com/v1';
  readonly hubEndpoint = 'https://gkehub.googleapis.com/v1';
  readonly cloudResourceManagerEndpoint = 'https://cloudresourcemanager.googleapis.com/v3';
  readonly connectGatewayHostPath = 'connectgateway.googleapis.com/v1';
  readonly auth: GoogleAuth;

  constructor(opts?: ClientOptions) {
    this.#logger = opts?.logger;

    this.auth = new GoogleAuth({
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      projectId: opts?.projectID,
    });

    this.#projectID = opts?.projectID;
    this.#quotaProjectID = opts?.quotaProjectID;
    this.#location = opts?.location;

    this.#headers = {
      'User-Agent': userAgent,
    };
    if (this.#quotaProjectID) {
      this.#headers['X-Goog-User-Project'] = this.#quotaProjectID;
    }
  }

  /**
   * Retrieves the auth client for authenticating requests.
   *
   * @returns string
   */
  async getToken(): Promise<string> {
    this.#logger?.debug(`Getting token`);

    const token = await this.auth.getAccessToken();
    if (!token) {
      throw new Error('Failed to generate token.');
    }
    return token;
  }

  /**
   * request is a wrapper around an authenticated request.
   *
   * @returns T
   */
  async request<T>(opts: GaxiosOptions): Promise<T> {
    this.#logger?.debug(`Initiating request with options: ${JSON.stringify(opts)}`);

    const mergedOpts: GaxiosOptions = {
      ...{
        retry: true,
        headers: this.#headers,
        errorRedactor: false,
      },
      ...opts,
    };

    this.#logger?.debug(`  Request options: ${JSON.stringify(mergedOpts)}`);

    const resp = await this.auth.request<T>(mergedOpts);
    return resp.data;
  }

  /**
   * Generates full resource name.
   *
   * @param name cluster name.
   * @returns full resource name.
   */
  getResource(name: string): string {
    name = (name || '').trim();
    if (!name) {
      throw new Error(`Failed to parse cluster name: name cannot be empty`);
    }

    if (name.includes('/')) {
      if (name.match(clusterResourceNamePattern)) {
        return name;
      } else {
        throw new Error(`Invalid cluster name "${name}"`);
      }
    }

    const projectID = this.#projectID;
    if (!projectID) {
      throw new Error(`Failed to get project ID to build cluster name. Try setting "project_id".`);
    }

    const location = this.#location;
    if (!location) {
      throw new Error(
        `Failed to get location (region/zone) to build cluster name. Try setting "location".`,
      );
    }

    return `projects/${projectID}/locations/${location}/clusters/${name}`;
  }

  /**
   * Converts a project ID to project number.
   *
   * @param projectID project ID.
   * @returns project number.
   */
  async projectIDtoNum(projectID: string): Promise<string> {
    this.#logger?.debug(`Converting project ID '${projectID}' to a project number`);

    const url = `${this.cloudResourceManagerEndpoint}/projects/${projectID}`;
    const resp = await this.request<{ name: string }>({
      url: url,
    });

    // projectRef of form projects/<project-num>"
    const projectRef = resp.name;
    const projectNum = projectRef.replace('projects/', '');
    if (!projectRef.includes('projects/') || !projectNum) {
      throw new Error(
        `Failed to parse project number: expected format projects/PROJECT_NUMBER. Got ${projectRef}`,
      );
    }
    return projectNum;
  }

  /**
   * Constructs a Connect Gateway endpoint string from the given fleet
   * membership name.
   *
   * @param name membership name in the format projects/p/locations/l/memberships/m
   * @returns endpoint.
   */
  async getConnectGWEndpoint(name: string): Promise<string> {
    this.#logger?.debug(`Getting connect gateway endpoint for '${name}'`);

    const membershipURL = `${this.hubEndpoint}/${name}`;
    const membership = await this.request<HubMembershipResponse>({
      url: membershipURL,
    });

    if (!membership) {
      throw new Error(`Failed to lookup membership: ${name}`);
    }

    // For GKE clusters, the configuration path is gkeMemberships, not
    // memberships. Googlers, see b/261052807 for more information.
    let collection = 'memberships';
    if (membership.endpoint?.gkeCluster) {
      collection = 'gkeMemberships';
    }

    // Parse the resulting membership name.
    const membershipName = ClusterClient.parseMembershipName(membership.name);

    // Extract the project number which is required for the connect gateway.
    const projectNumber = await this.projectIDtoNum(membershipName.projectID);

    return `${this.connectGatewayHostPath}/projects/${projectNumber}/locations/${membershipName.location}/${collection}/${membershipName.membershipName}`;
  }

  /**
   * discoverClusterMembership attempts to discover fleet membership of a
   * cluster.
   *
   * @param clusterName cluster name.
   * @returns Fleet membership name.
   */
  async discoverClusterMembership(clusterName: string): Promise<string> {
    this.#logger?.debug(`Discovering cluster membership for '${clusterName}'`);

    const clusterResourceLink = `//container.googleapis.com/${this.getResource(clusterName)}`;
    const projectID = this.#projectID;
    if (!projectID) {
      throw new Error(
        `Failed to get project ID for cluster membership discovery. Try setting "project_id".`,
      );
    }

    const url = `${this.hubEndpoint}/projects/${projectID}/locations/global/memberships?filter=endpoint.gkeCluster.resourceLink="${clusterResourceLink}"`;
    const resp = await this.request<HubMembershipsResponse>({
      url: url,
    });

    const memberships = resp.resources;
    if (!memberships || memberships.length < 1) {
      throw new Error(
        `Expected one membership for ${clusterName} in ${projectID}. ` +
          `Found none. Verify membership by running \`gcloud container fleet memberships list --project ${projectID}\``,
      );
    }
    if (memberships.length > 1) {
      const membershipNames = memberships.map((m) => m.name).join(',');
      throw new Error(
        `Expected one membership for ${clusterName} in ${projectID}. ` +
          `Found multiple memberships ${membershipNames}. Provide an explicit membership via \`fleet_membership\` input.`,
      );
    }

    const membership = memberships[0];
    return membership.name;
  }

  /**
   * Retrieves a Cluster.
   *
   * @param fqn Cluster name
   * @returns a Cluster object.
   */
  async getCluster(clusterName: string): Promise<ClusterResponse> {
    this.#logger?.debug(`Getting information about cluster '${clusterName}'`);

    const url = `${this.defaultEndpoint}/${this.getResource(clusterName)}`;
    const resp = await this.request<ClusterResponse>({
      url: url,
    });
    return resp;
  }

  /**
   * Create kubeconfig for cluster.
   *
   * @param opts Input options. See CreateKubeConfigOptions.
   */
  async createKubeConfig(opts: CreateKubeConfigOptions): Promise<string> {
    this.#logger?.debug(`Creating kubeconfig with options: ${JSON.stringify(opts)}`);

    const cluster = opts.clusterData;
    let endpoint = cluster.endpoint;
    const connectGatewayEndpoint = presence(opts.connectGWEndpoint);
    if (connectGatewayEndpoint) {
      endpoint = connectGatewayEndpoint;
    }
    if (opts.useInternalIP) {
      endpoint = cluster.privateClusterConfig.privateEndpoint;
    }
    if (opts.useDNSBasedEndpoint) {
      endpoint = cluster.controlPlaneEndpointsConfig.dnsEndpointConfig.endpoint;
    }

    // By default, use the CA cert. Even if user doesn't specify
    // `use_dns_based_endpoint:true`, if the endpoint is DNS-based endpoint
    // (suffix: "gke.goog"), we can not use the cluster's CA cert.
    let useCACert = true;
    if (connectGatewayEndpoint || opts.useDNSBasedEndpoint || endpoint.endsWith('gke.goog')) {
      useCACert = false;
    }

    const token = await this.getToken();
    const auth = opts.useAuthProvider
      ? { user: { 'auth-provider': { name: 'gcp' } } }
      : { user: { token: token } };
    const contextName = opts.contextName;

    const kubeConfig: KubeConfig = {
      'apiVersion': 'v1',
      'clusters': [
        {
          cluster: {
            ...(useCACert && {
              'certificate-authority-data': cluster.masterAuth?.clusterCaCertificate,
            }),
            server: `https://${endpoint}`,
          },
          name: cluster.name,
        },
      ],
      'contexts': [
        {
          context: {
            cluster: cluster.name,
            user: cluster.name,
            namespace: opts.namespace,
          },
          name: contextName,
        },
      ],
      'kind': 'Config',
      'current-context': contextName,
      'users': [{ ...{ name: cluster.name }, ...auth }],
    };

    return YAML.stringify(kubeConfig);
  }
}

type cluster = {
  cluster: {
    'certificate-authority-data'?: string;
    'server': string;
  };
  name: string;
};

type context = {
  context: {
    cluster: string;
    user: string;
    namespace?: string;
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

  // useDNSBasedEndpoint is a boolean to use the DNS-based endpoint of the
  // cluster.
  useDNSBasedEndpoint: boolean;

  // clusterData is the cluster response data.
  clusterData: ClusterResponse;

  // connectGWEndpoint is the optional Connect Gateway endpoint.
  connectGWEndpoint?: string;

  // contextName is the name of the context.
  contextName: string;

  // namespace is the name of the Kubernetes namespace.
  namespace?: string;
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
  name: string;
  endpoint: string;
  masterAuth: {
    clusterCaCertificate: string;
  };
  privateClusterConfig: {
    privateEndpoint: string;
  };
  controlPlaneEndpointsConfig: {
    dnsEndpointConfig: {
      endpoint: string;
    };
  };
};

/**
 * HubMembershipsResponse is the response from listing GKE Hub memberships.
 */
type HubMembershipsResponse = {
  resources: HubMembership[];
};

/**
 * HubMembershipResponse is the response from getting a GKE Hub membership.
 */
type HubMembershipResponse = HubMembership;

/**
 * HubMembership is a single HubMembership.
 */
type HubMembership = {
  name: string;
  description: string;
  uniqueId: string;

  endpoint?: {
    gkeCluster?: {
      resourceLink: string;
    };
  };
};
