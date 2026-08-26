function extensionFromFilename(filename) {
  const match = String(filename ?? '').match(/(\.[a-z0-9]{1,8})$/i);
  return match ? match[1].toLowerCase() : '.png';
}

function safeTitle(title) {
  return String(title ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '未命名动画';
}

export function selectedImageDownloadFilename({ index, total, title, sourceFilename }) {
  const order = Math.max(1, Number(index) + 1);
  const width = Math.max(2, String(Math.max(1, Number(total))).length);
  return `${String(order).padStart(width, '0')}-${safeTitle(title)}${extensionFromFilename(sourceFilename)}`;
}
