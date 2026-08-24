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

export async function readYucImportEvents(response, onEvent) {
  if (!response.ok) {
    await readYucImportResponse(response);
    return;
  }
  if (!response.body) {
    throw new Error('浏览器无法读取导出进度。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const emitLines = async (flush = false) => {
    const lines = buffer.split('\n');
    buffer = flush ? '' : lines.pop();
    for (const line of lines) {
      if (line.trim()) await onEvent(JSON.parse(line));
    }
    if (flush && buffer.trim()) await onEvent(JSON.parse(buffer));
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    await emitLines();
  }
  buffer += decoder.decode();
  await emitLines(true);
}
