import { apiGetWithRefresh } from './client';

export function getBookmarkFolders(): JQueryDeferred<any> {
  return apiGetWithRefresh('/v1/bookmarks');
}

export function getBookmarkItems(folderId: number, page?: number): JQueryDeferred<any> {
  var params: Record<string, any> = {};
  if (page) { params.page = page; }
  return apiGetWithRefresh('/v1/bookmarks/' + folderId, params);
}
