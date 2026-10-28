// Authentication callback page that returns native iOS OAuth responses to the installed app
const callback = new URL(location.href);
if (callback.origin === 'https://tripcash.de' && callback.pathname === '/auth-callback') {
  const allowed = new Set(['code', 'error', 'error_code', 'error_description', 'type', 'intent']);
  const params = new URLSearchParams();
  if (callback.href.length <= 4096 && !callback.hash) {
    for (const [key, value] of callback.searchParams) {
      if (allowed.has(key) && value.length <= 2048) params.append(key, value);
    }
  }
  const hasAuthResult = params.has('code') || params.has('error');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '');
  if (hasAuthResult && isIOS) {
    const nativeCallback = new URL('com.tripcash.app://auth-callback');
    nativeCallback.search = params.toString();
    location.replace(nativeCallback.href);
    setTimeout(() => location.replace(`/app?${params}`), 1500);
  } else {
    location.replace(hasAuthResult ? `/app?${params}` : '/app');
  }
} else {
  location.replace('/app');
}
