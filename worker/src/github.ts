interface GitHubContent {
  content: string;
  encoding: string;
}

interface GitHubCommit {
  content: {
    sha: string;
  };
}

export async function ensureContentPath(
  token: string,
  repo: string,
  path: string,
): Promise<void> {
  const url = `https://api.github.com/repos/${repo}/contents/${path}/.gitkeep`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'i-a-trend-worker',
    },
    body: JSON.stringify({
      message: 'chore: ensure content path',
      content: btoa(''),
      branch: 'main',
    }),
  });

  if (response.status !== 201 && response.status !== 422) {
    console.error(`Erro ao criar path: ${response.status}`);
  }
}

export async function pushMarkdownFile(
  token: string,
  repo: string,
  filePath: string,
  markdownContent: string,
  commitMessage: string,
): Promise<boolean> {
  const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

  const encodedContent = btoa(markdownContent);

  let existingSha: string | undefined;
  const getResponse = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'i-a-trend-worker',
    },
  });

  if (getResponse.ok) {
    const existing = await getResponse.json() as GitHubContent & { sha: string };
    existingSha = existing.sha;
  }

  const body: Record<string, unknown> = {
    message: commitMessage,
    content: encodedContent,
    branch: 'main',
  };
  if (existingSha) body.sha = existingSha;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'i-a-trend-worker',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Erro GitHub (${response.status}): ${errorText}`);
    return false;
  }

  return true;
}

export function generateMarkdown(article: {
  title: string;
  slug: string;
  excerpt: string;
  sourceUrl: string;
  sourceName: string;
  category: string;
  publishedAt: string;
  imageUrl: string | null;
  tags: string[];
  content: string;
  contentFull?: string;
}): string {
  const tagsYaml = article.tags.length > 0
    ? `\n${article.tags.map(t => `  - ${t}`).join('\n')}`
    : ' []';

  const imageYaml = article.imageUrl
    ? `\nimageUrl: "${article.imageUrl}"`
    : '';

  const contentFullYaml = article.contentFull
    ? `\ncontentFull: |\n  ${article.contentFull.replace(/\n/g, '\n  ')}`
    : '';

  const bodyContent = article.contentFull || article.content;

  return `---
title: "${article.title.replace(/"/g, '\\"')}"
slug: "${article.slug}"
excerpt: "${article.excerpt.replace(/"/g, '\\"')}"
sourceUrl: "${article.sourceUrl}"
sourceName: "${article.sourceName}"
category: "${article.category}"
publishedAt: "${article.publishedAt}"${imageYaml}${contentFullYaml}
tags:${tagsYaml}
---

${bodyContent}

---

*Fonte: [${article.sourceName}](${article.sourceUrl})*
`;
}

function btoa(input: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  const bytes: number[] = Array.from(data);

  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = bytes[i + 1] || 0;
    const b3 = bytes[i + 2] || 0;

    result += base64Chars[b1 >> 2];
    result += base64Chars[((b1 & 3) << 4) | (b2 >> 4)];
    result += base64Chars[((b2 & 15) << 2) | (b3 >> 6)];
    result += base64Chars[b3 & 63];
  }

  const padding = bytes.length % 3;
  if (padding === 1) result = result.slice(0, -2) + '==';
  else if (padding === 2) result = result.slice(0, -1) + '=';

  return result;
}