export async function readYucImportResponse(response) {
  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    if (response.status === 404) {
      throw new Error('本地服务尚未更新。请在运行 npm run dev 的终端按 Ctrl+C，再重新启动。');
    }
    throw new Error(`本地服务返回了无法识别的内容（HTTP ${response.status}）。`);
  }

  if (!response.ok) {
    throw new Error(payload.error || `获取失败：HTTP ${response.status}`);
  }
  return payload;
}
