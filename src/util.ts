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
