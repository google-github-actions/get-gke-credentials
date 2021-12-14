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
import { ExternalAccountClientOptions } from 'google-auth-library';

import {
  errorMessage,
  isServiceAccountKey,
  parseServiceAccountKeyJSON,
  ServiceAccountKey,
  writeFile,
} from './util';
import { ClusterClient } from './gkeClient';

async function run(): Promise<void> {
  try {
    // Get inputs
    const name = getInput('cluster_name', { required: true });
    const location = getInput('location', { required: true });
    const credentials = getInput('credentials');
    let projectID = getInput('project_id');
    const useAuthProvider = getBooleanInput('use_auth_provider');
    const useInternalIP = getBooleanInput('use_internal_ip');

    // Add warning if using credentials
    let credentialsJSON: ServiceAccountKey | ExternalAccountClientOptions | undefined;
    if (credentials) {
      logWarning(
        'The "credentials" input is deprecated. ' +
          'Please switch to using google-github-actions/auth which supports both Workload Identity Federation and JSON Key authentication. ' +
          'For more details, see https://github.com/google-github-actions/get-gke-credentials#authorization',
      );

      credentialsJSON = parseServiceAccountKeyJSON(credentials);
    }

    // Pick the best project ID.
    if (!projectID) {
      if (credentialsJSON && isServiceAccountKey(credentialsJSON)) {
        projectID = credentialsJSON?.project_id;
        logInfo(`Extracted project ID '${projectID}' from credentials JSON`);
      } else if (process.env?.GCLOUD_PROJECT) {
        projectID = process.env.GCLOUD_PROJECT;
        logInfo(`Extracted project ID '${projectID}' from $GCLOUD_PROJECT`);
      }
    }

    // Create Container Cluster client
    const client = new ClusterClient({
      projectID: projectID,
      location: location,
      credentials: credentialsJSON,
    });

    // Get Cluster object
    const clusterData = await client.getCluster(name);

    // Create KubeConfig
    const kubeConfig = await client.createKubeConfig({
      useAuthProvider: useAuthProvider,
      useInternalIP: useInternalIP,
      clusterData: clusterData,
    });

    // Write kubeconfig to disk
    const kubeConfigPath = await writeFile(kubeConfig);

    // Export KUBECONFIG env var with path to kubeconfig
    exportVariable('KUBECONFIG', kubeConfigPath);
    logInfo(`Successfully created and exported "KUBECONFIG" at ${kubeConfigPath}`);
  } catch (err) {
    const msg = errorMessage(err);
    setFailed(`google-github-actions/get-gke-credentials failed with: ${msg}`);
  }
}

run();
