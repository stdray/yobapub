import { apiClient } from './client';
import { BookmarkFoldersResponse, BookmarkItemsResponse } from '../types/api';

export const getBookmarkFolders = (): JQueryDeferred<BookmarkFoldersResponse> =>
  apiClient.apiGetWithRefresh('/v1/bookmarks');

export const getBookmarkItems = (folderId: number, page?: number): JQueryDeferred<BookmarkItemsResponse> => {
  const params: Record<string, number> = {};
  if (page) { params.page = page; }
  return apiClient.apiGetWithRefresh('/v1/bookmarks/' + folderId, params);
};
