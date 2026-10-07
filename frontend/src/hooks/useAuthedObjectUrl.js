import { useEffect, useState } from 'react';
import { api } from '../api/client';

/** Downloads a protected file (needs the bearer token) and exposes it as an object URL. */
export function useAuthedObjectUrl(url) {
  const [objectUrl, setObjectUrl] = useState(null);

  useEffect(() => {
    if (!url) return undefined;
    let revoked = false;
    let created;
    api
      .fetchBlob(url)
      .then((blob) => {
        if (revoked) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch(() => setObjectUrl(null));
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  return objectUrl;
}
