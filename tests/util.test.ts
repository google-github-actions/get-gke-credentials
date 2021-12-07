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

import fs from 'fs';
import { writeFile } from '../src/util';
import os from 'os';

describe('writeFile', function () {
  it('writes to file', async function () {
    const githubWorkspace = os.tmpdir();
    process.env.GITHUB_WORKSPACE = githubWorkspace;

    const pth = await writeFile('test content');
    expect(fs.existsSync(pth)).to.be.true;
    expect(fs.readFileSync(pth).toString('utf8')).to.eq('test content');
  });

  it('throws an error if GITHUB_WORKSPACE is not set', async () => {
    delete process.env.GITHUB_WORKSPACE;

    try {
      await writeFile('test content');
      throw new Error('should have thrown an error');
    } catch (err) {
      expect(`${err}`).to.include('Missing GITHUB_WORKSPACE!');
    }
  });

  it('throws an error if unable to write to file', async () => {
    process.env.GITHUB_WORKSPACE = '/totally/not/a/real/path';

    try {
      await writeFile('test content');
      throw new Error('should have thrown an error');
    } catch (err) {
      expect(`${err}`).to.include('Failed to write kubeconfig');
    }
  });
});
