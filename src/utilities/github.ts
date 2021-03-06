import { Definitions, Modules } from './project';
import * as moment from 'moment';
import * as Storage from './storage';
import * as Location from './location';

const LOCAL_STORAGE_PREFIX = 'tspg-app-';

const ACCESS_TOKEN = 'accessToken';

const CLIENT_ID = '0138dec573cf22322bb3';

const REDIRECT_URI = `${window.location.origin}${window.location.pathname}`;

const SCOPES = 'user:email,gist';

let user: GithubAuthenticatedUser | void = undefined;

let accessToken = Storage.getStorageItem(LOCAL_STORAGE_PREFIX, ACCESS_TOKEN);

export const GITHUB_OAUTH_URL =
  `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=${SCOPES}`;

export function checkAuthentication() {
  return !!accessToken;
}

export async function maybeAuthenticate() {
  const code = Location.getQueryStringParameter('code');
  if (code) {
    accessToken = await getAccessToken(code);
    if (accessToken) {
      const expires = moment().add(14, 'days').toDate();
      Storage.setStorageItem(LOCAL_STORAGE_PREFIX, ACCESS_TOKEN, accessToken, expires);
      // tslint:disable-next-line no-console
      console.info('Github authentication successful.', accessToken);
      return true;
    } else {
      accessToken = undefined;
      Storage.removeStorageItem(LOCAL_STORAGE_PREFIX, ACCESS_TOKEN);
      alert('Github authentication failed');
    }
  }
  return false;
}

async function getAccessToken(code: string) {
  try {
    const res = await fetch(`https://gatekeeper.abstractsequential.com/authenticate/${code}`);
    const json = await res.json();
    return json.token as string;
  } catch (e) {
    alert('Error authenticating with Github');
    return;
  }
}

export function logout() {
  Storage.removeStorageItem(LOCAL_STORAGE_PREFIX, ACCESS_TOKEN);
}

function getAuthorizationHeader() {
  return { 'Authorization': `token ${accessToken}` };
}

export async function getUser() {
  if (!accessToken) { return; }
  if (user) { return user; }
  try {
    const res = await fetch('https://api.github.com/user', { headers: getAuthorizationHeader() });
    user = await res.json() as GithubAuthenticatedUser;
    return user;

  } catch (e) {
    alert('Error retrieving user');
    return;
  }
}

export function clearGists() {
  Storage.removeStorageItem(LOCAL_STORAGE_PREFIX, 'github_gists');
}

export async function listGists(username?: string) {
  let gists = Storage.getStorageItem(LOCAL_STORAGE_PREFIX, 'github_gists');
  if (gists) { return gists; }
  if (!accessToken) { return; }
  const url = `https://api.github.com${username ? `/users/${username}` : ''}/gists`;
  try {
    const res = await fetch(url, { headers: getAuthorizationHeader() });
    gists = await res.json() as Gist[];
    Storage.setStorageItem(LOCAL_STORAGE_PREFIX, 'github_gists', gists);
    return gists;
  } catch (e) {
    alert('Error retrieving user');
    return;
  }
}

export async function getGist(id: string, rev?: string) {
  try {
    const res = await fetch(`https://api.github.com/gists/${id}${rev ? `/${rev}` : ''}`);
    return await res.json() as Gist;
  } catch (e) {
    alert('Error fetching gist');
    return;
  }
}

export async function getFile(url: string) {
  const res = await fetch(url);
  return await res.text();
}

export interface GithubUserInfo {
  login: string;
  id: number;
  avatar_url: string;
  gravatar_id: string;
  url: string;
  html_url: 'string';
  followers_url: string;
  following_url: string;
  gists_url: string;
  starred_url: string;
  subscriptions_url: string;
  organizations_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  type: string;
  side_admin: boolean;
}

export interface GithubUser extends GithubUserInfo {
  name: string;
  company: string;
  blog: string;
  location: string;
  email: string;
  hireable: boolean;
  bio: string;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  created_at: string;
  updated_at: string;
}

export interface GithubAuthenticatedUser extends GithubUser {
  total_private_repos: number;
  owned_private_repos: number;
  private_gists: number;
  disk_usage: number;
  collaborators: number;
  two_factor_authentication: boolean;
  plan: {
    name: string;
    space: number;
    private_repos: number;
    collaborators: number;
  };
}

export interface GistFork {
  user: GithubUser;
  url: string;
  id: string;
  created_at: string;
  updated_at: string;
}

export interface GistHistory {
  url: string;
  version: string;
  user: GithubUserInfo;
  change_status: {
    deletions: number;
    additions: number;
    total: number;
  };
  committed_at: string;
}

export interface GistDescription {
  description: string;
  public: boolean;
  files: GistFiles;
}

export interface Gist extends GistDescription {
  url: string;
  forks_url: string;
  commits_url: string;
  id: string;
  owner: GithubUserInfo;
  user?: string;
  truncated: boolean;
  comments: number;
  comments_url: string;
  html_url: string;
  git_pull_url: string;
  git_push_url: string;
  created_at: string;
  updated_at: string;
  forks: GistFork[];
  history: GistHistory[];

}

export interface GistFile {
  content: string;
  filename?: string;
}

export interface GistFiles { [fileName: string]: GistFile; }

export class GistFilesBuilder {
  files: GistFiles = {};

  constructor(files?: GistFiles) {
    if (files) {
      Object.keys(files).forEach(filePath => { this.files[relativeToGistPath(filePath)] = files[filePath]; });
    }
  }

  toFiles = () => this.files;

  addFile = (fileName: string, content: string = '') => content && (this.files[fileName] = { content });

  removeFile = (fileName: string) => delete this.files[fileName];
}

function relativeToGistPath(filePath: string) {
  let path = filePath.startsWith('./') ? filePath.slice(2) : filePath;
  return path.replace(/\//g, '___');
}

export async function createGist(
  description: string,
  files: GistFiles,
  definitions: Definitions,
  packages: Modules,
  isPublic: boolean = true,
) {
  if (!accessToken) { return; }
  const fb = new GistFilesBuilder(files);
  fb.addFile('definitions.json', JSON.stringify(definitions));
  fb.addFile('modules.json', JSON.stringify(packages));
  Object.keys(fb.files).forEach(fileName => !fb.files[fileName].content && fb.removeFile(fileName));
  const data = { description, public: isPublic, files: fb.toFiles() };
  try {
    const body = JSON.stringify(data);
    if (!body) {
      alert('Fatal error: unprocessable body.  Please file an issue with source!');
      return;
    }
    const res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: getAuthorizationHeader(),
      body
    });
    const gist = await res.json() as Gist;
    try {
      const url = `https://jmfirth.github.io/typescript-playground/?gistId=${gist.id}`;
      await addCommentToGist(gist.id, `View this in the [TypeScript Playground](${url}).`);
      clearGists();
      await listGists();
    } catch (f) {
      alert('Was not able to add TypeScript Playground url as a comment to the new gist');
    }
    return gist;
  } catch (e) {
    alert('Error creating gist');
    return;
  }
}

export async function addCommentToGist(gistId: string, body: string) {
  if (!accessToken) { return; }
  const res = await fetch(`https://api.github.com/gists/${gistId}/comments`, {
    method: 'POST',
    headers: getAuthorizationHeader(),
    body: JSON.stringify({ body }),
  });
  return await res.json();
}

export async function updateGist(
  gistId: string,
  description: string,
  files: GistFiles,
  definitions: Definitions,
  modules: Modules
) {
  if (!accessToken) { return; }
  const fb = new GistFilesBuilder(files);
  fb.addFile('definitions.json', JSON.stringify(definitions));
  fb.addFile('modules.json', JSON.stringify(modules));
  const data = { description, files: fb.toFiles() };
  try {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: getAuthorizationHeader(),
      body: JSON.stringify(data)
    });
    return await res.json() as Gist;
  } catch (e) {
    alert('Error updating gist');
    return;
  }
}