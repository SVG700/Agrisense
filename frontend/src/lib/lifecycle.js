/** The trap's lifecycle forecast (targeted timing), refetched when a new capture arrives. */
import { useEffect, useState } from 'react';
import { api } from '../api.js';

export function useLifecycle(deviceId, refreshKey) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!deviceId) return undefined;
    let off = false;
    setData(null);
    api
      .lifecycle(deviceId)
      .then((d) => !off && setData(d && typeof d.available === 'boolean' ? d : null))
      .catch(() => !off && setData({ available: false, reason: 'Timing unavailable right now.' }));
    return () => {
      off = true;
    };
  }, [deviceId, refreshKey]);
  return data;
}
