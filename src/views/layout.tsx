import type { FC, PropsWithChildren } from "hono/jsx";

export interface LayoutProps {
  title: string;
  bodyClass?: string;
}

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title,
  bodyClass = "",
  children,
}) => {
  return (
    <html lang="ko">
      <head>
        <title>{title}</title>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="/css/main.css" />
        <link
          rel="stylesheet"
          as="style"
          crossorigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var savedTheme = localStorage.getItem('pikiland-theme') || 'dark';
                document.documentElement.setAttribute('data-theme', savedTheme);
              })();
            `,
          }}
        />
      </head>
      <body class={bodyClass}>
        {children}
      </body>
    </html>
  );
};
