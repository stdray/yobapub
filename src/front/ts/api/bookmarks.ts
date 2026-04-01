import { apiClient } from './client';

export function getBookmarkFolders(): JQueryDeferred<any> {
  return apiClient.apiGetWithRefresh('/v1/bookmarks');
}

export function getBookmarkItems(folderId: number, page?: number): JQueryDeferred<any> {
  const params: Record<string, any> = {};
  if (page) { params.page = page; }
  return apiClient.apiGetWithRefresh('/v1/bookmarks/' + folderId, params);
}
