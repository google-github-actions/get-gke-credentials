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

import { join as pathjoin } from 'path';

import {
  exportVariable,
  getInput,
  debug as logDebug,
  info as logInfo,
  setFailed,
  setOutput,
} from '@actions/core';
import {
  errorMessage,
  parseBoolean,
  presence,
  randomFilename,
  writeSecureFile,
} from '@google-github-actions/actions-utils';

import { ClusterClient } from './client';

export async function run(): Promise<void> {
  try {
    // Get inputs
    let projectID = getInput('project_id');
    const quotaProjectID = getInput('quota_project_id');
    let location = getInput('location');
    const clusterName = ClusterClient.parseResourceName(
      getInput('cluster_name', { required: true }),
    );
    const useAuthProvider = parseBoolean(getInput('use_auth_provider'));
    const useInternalIP = parseBoolean(getInput('use_internal_ip'));
    let contextName = getInput('context_name');
    const namespace = presence(getInput('namespace'));
    const useConnectGateway = parseBoolean(getInput('use_connect_gateway'));

    // Only one of use_connect_gateway or use_internal_ip should be provided
    if (useInternalIP && useConnectGateway) {
      throw new Error(
        'The workflow must specify only one of `use_internal_ip` or `use_connect_gateway`',
      );
    }

    // Ensure a workspace is set.
    const githubWorkspace = process.env.GITHUB_WORKSPACE;
    if (!githubWorkspace) {
      throw new Error('$GITHUB_WORKSPACE is not set');
    }

    // Pick the best project ID.
    if (!projectID) {
      if (clusterName.projectID) {
        projectID = clusterName.projectID;
        logDebug(`Extracted projectID "${projectID}" from cluster resource name`);
      } else if (process.env?.GCLOUD_PROJECT) {
        projectID = process.env.GCLOUD_PROJECT;
        logDebug(`Extracted project ID "${projectID}" from $GCLOUD_PROJECT`);
      } else {
        throw new Error(
          `Failed to extract project ID, please set the "project_id" input, ` +
            `set $GCLOUD_PROJECT, or specify the cluster name as a full ` +
            `resource name.`,
        );
      }
    }

    // Pick the best location.
    if (!location) {
      if (clusterName.location) {
        location = clusterName.location;
        logDebug(`Extracted location "${location}" from cluster resource name`);
      } else {
        throw new Error(
          `Failed to extract location, please set the "location" input or ` +
            `specify the cluster name as a full resource name.`,
        );
      }
    }

    // Pick the best context name.
    if (!contextName) {
      contextName = `gke_${projectID}_${location}_${clusterName.id}`;
    }
    logDebug(`Using context name: ${contextName}`);

    // Create Container Cluster client
    const client = new ClusterClient({
      projectID: projectID,
      quotaProjectID: quotaProjectID,
      location: location,
    });

    // Get Cluster object
    const clusterData = await client.getCluster(clusterName.id);
    logDebug(`Found cluster data: ${JSON.stringify(clusterData, null, 2)}`);

    // If using Connect Gateway, get endpoint
    let connectGWEndpoint;
    if (useConnectGateway) {
      logDebug(`Using connect gateway`);

      const fleetMembershipName =
        presence(getInput('fleet_membership_name')) ||
        (await client.discoverClusterMembership(clusterName.id));
      logDebug(`Using fleet membership: ${fleetMembershipName}`);

      connectGWEndpoint = await client.getConnectGWEndpoint(fleetMembershipName);
      logDebug(`Using connect gateway endpoint: ${connectGWEndpoint}`);
    }

    // Create KubeConfig
    const kubeConfig = await client.createKubeConfig({
      useAuthProvider: useAuthProvider,
      useInternalIP: useInternalIP,
      connectGWEndpoint: connectGWEndpoint,
      clusterData: clusterData,
      contextName: contextName,
      namespace: namespace,
    });

    // Write kubeconfig to disk
    try {
      const filename = 'gha-kubeconfig-' + randomFilename(8);
      const kubeConfigPath = pathjoin(githubWorkspace, filename);
      logDebug(`Creating KUBECONFIG at ${kubeConfigPath}`);
      await writeSecureFile(kubeConfigPath, kubeConfig, { mode: 0o600 });

      exportVariable('KUBECONFIG', kubeConfigPath);
      exportVariable('KUBE_CONFIG_PATH', kubeConfigPath);
      setOutput('kubeconfig_path', kubeConfigPath);
      logInfo(`Successfully created and exported "KUBECONFIG" at: ${kubeConfigPath}`);
    } catch (err) {
      const msg = errorMessage(err);
      throw new Error(`Failed to write Kubernetes config file: ${msg}`);
    }
  } catch (err) {
    const msg = errorMessage(err);
    setFailed(`google-github-actions/get-gke-credentials failed with: ${msg}`);
  }
}

if (require.main === module) {
  run();
}
