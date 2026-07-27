type ApiResponse<T> = { success: boolean; data?: T; message?: string };

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error('服务响应异常：接口返回空内容，请刷新页面或重启服务。');
  }

  let payload: ApiResponse<T>;
  try {
    payload = JSON.parse(text) as ApiResponse<T>;
  } catch {
    throw new Error('服务版本不匹配，请刷新页面或重启服务。');
  }

  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.message ?? '请求失败');
  }
  return payload.data;
}

export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  return readJsonResponse<T>(await fetch(url, options));
}
