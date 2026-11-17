/**
 * pi-web 与 pi 的版本号：构建注入的环境变量（next.config.ts），侧栏页脚展示。
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
export const PI_VERSION = process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0";
