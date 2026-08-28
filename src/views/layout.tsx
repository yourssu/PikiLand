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
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&display=swap"
          rel="stylesheet"
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
