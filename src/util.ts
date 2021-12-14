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

import { promises as fs } from 'fs';
import { join as pathjoin } from 'path';
import { randomBytes } from 'crypto';

import { ExternalAccountClientOptions } from 'google-auth-library';

/**
 * Write content to a file
 *
 * @param fileContent File content to write.
 * @returns file path.
 */
export async function writeFile(fileContent: string): Promise<string> {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!workspace) {
    throw new Error('Missing GITHUB_WORKSPACE!');
  }

  // Generate a random filename to store the credential. 12 bytes is 24
  // characters in hex. It's not the ideal entropy, but we have to be under the
  // 255 character limit for Windows filenames (which includes their entire
  // leading path).
  const uniqueName = randomBytes(12).toString('hex');
  const kubeConfigPath = pathjoin(workspace, uniqueName);

  try {
    await fs.writeFile(kubeConfigPath, fileContent);
    return kubeConfigPath;
  } catch (err) {
    throw new Error(`Failed to write kubeconfig to ${kubeConfigPath}: ${err}`);
  }
}

/**
 * fromBase64 base64 decodes the result, taking into account URL and standard
 * encoding with and without padding.
 *
 * TODO(sethvargo): Candidate for centralization.
 *
 */
export function fromBase64(s: string): string {
  let str = s.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

export type ServiceAccountKey = {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
};

/**
 * parseServiceAccountKeyJSON attempts to parse the given string as a service
 * account key JSON. It handles if the string is base64-encoded.
 *
 * TODO(sethvargo): Candidate for centralization.
 */
export function parseServiceAccountKeyJSON(
  str: string,
): ServiceAccountKey | ExternalAccountClientOptions {
  if (!str) str = '';

  str = str.trim();
  if (!str) {
    throw new Error(`Missing service account key JSON (got empty value)`);
  }

  // If the string doesn't start with a JSON object character, it is probably
  // base64-encoded.
  if (!str.startsWith('{')) {
    str = fromBase64(str);
  }

  let creds: ServiceAccountKey | ExternalAccountClientOptions;
  try {
    creds = JSON.parse(str);
  } catch (err) {
    const msg = errorMessage(err);
    throw new SyntaxError(`Failed to parse service account key JSON credentials: ${msg}`);
  }

  return creds;
}

/**
 * isServiceAccountKey returns true if the given interface is a
 * ServiceAccountKey, false otherwise.
 */
export function isServiceAccountKey(
  obj: ServiceAccountKey | ExternalAccountClientOptions,
): obj is ServiceAccountKey {
  return (obj as ServiceAccountKey).project_id !== undefined;
}

/**
 * errorMessage extracts the error message from the given error.
 *
 * TODO(sethvargo): Candidate for centralization.
 *
 */
export function errorMessage(err: unknown): string {
  if (!err) {
    return '';
  }

  let msg = err instanceof Error ? err.message : `${err}`;
  msg = msg.trim();
  msg = msg.replace('Error: ', '');
  msg = msg.trim();

  if (!msg) {
    return '';
  }

  msg = msg[0].toLowerCase() + msg.slice(1);
  return msg;
}
