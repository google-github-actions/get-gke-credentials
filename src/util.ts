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

import * as fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

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
  const kubeConfigPath = path.join(workspace, uuidv4());
  try {
    await fs.writeFileSync(kubeConfigPath, fileContent);
    return kubeConfigPath;
  } catch (err) {
    throw new Error(`Unable to write kubeconfig to file: ${kubeConfigPath}`);
  }
}
