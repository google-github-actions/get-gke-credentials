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

import {
  exportVariable,
  getBooleanInput,
  getInput,
  info as logInfo,
  setFailed,
  warning as logWarning,
} from '@actions/core';
import {
  Credential,
  errorMessage,
  isServiceAccountKey,
  parseCredential,
  randomFilepath,
  writeSecureFile,
} from '@google-github-actions/actions-utils';

import { ClusterClient } from './gkeClient';

async function run(): Promise<void> {
  try {
    // Get inputs
    let projectID = getInput('project_id');
    let location = getInput('location');
    const clusterName = ClusterClient.parseResourceName(
      getInput('cluster_name', { required: true }),
    );
    const credentials = getInput('credentials');
    const useAuthProvider = getBooleanInput('use_auth_provider');
    const useInternalIP = getBooleanInput('use_internal_ip');
    let contextName = getInput('context_name');

    // Add warning if using credentials
    let credentialsJSON: Credential | undefined;
    if (credentials) {
      logWarning(
        'The "credentials" input is deprecated. ' +
          'Please switch to using google-github-actions/auth which supports both Workload Identity Federation and JSON Key authentication. ' +
          'For more details, see https://github.com/google-github-actions/get-gke-credentials#authorization',
      );

      credentialsJSON = parseCredential(credentials);
    }

    // Pick the best project ID.
    if (!projectID) {
      if (clusterName.projectID) {
        projectID = clusterName.projectID;
        logInfo(`Extracted projectID "${projectID}" from cluster resource name`);
      } else if (credentialsJSON && isServiceAccountKey(credentialsJSON)) {
        projectID = credentialsJSON?.project_id;
        logInfo(`Extracted project ID "${projectID}" from credentials JSON`);
      } else if (process.env?.GCLOUD_PROJECT) {
        projectID = process.env.GCLOUD_PROJECT;
        logInfo(`Extracted project ID "${projectID}" from $GCLOUD_PROJECT`);
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
        logInfo(`Extracted location "${location}" from cluster resource name`);
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

    // Create Container Cluster client
    const client = new ClusterClient({
      projectID: projectID,
      location: location,
      credentials: credentialsJSON,
    });

    // Get Cluster object
    const clusterData = await client.getCluster(clusterName.id);

    // Create KubeConfig
    const kubeConfig = await client.createKubeConfig({
      useAuthProvider: useAuthProvider,
      useInternalIP: useInternalIP,
      clusterData: clusterData,
      contextName: contextName,
    });

    // Write kubeconfig to disk
    try {
      const workspace = process.env.GITHUB_WORKSPACE;
      if (!workspace) {
        throw new Error('Missing $GITHUB_WORKSPACE!');
      }

      const kubeConfigPath = await writeSecureFile(randomFilepath(workspace), kubeConfig);
      exportVariable('KUBECONFIG', kubeConfigPath);
      logInfo(`Successfully created and exported "KUBECONFIG" at ${kubeConfigPath}`);
    } catch (err) {
      const msg = errorMessage(err);
      throw new Error(`Failed to write Kubernetes config file: ${msg}`);
    }
  } catch (err) {
    const msg = errorMessage(err);
    setFailed(`google-github-actions/get-gke-credentials failed with: ${msg}`);
  }
}

run();
