export const extractHostname = (url: string): string => {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1] : '';
};
