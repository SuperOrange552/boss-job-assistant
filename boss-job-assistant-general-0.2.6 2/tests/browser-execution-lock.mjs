// 用户于 2026-09-05 禁止所有浏览器控制和浏览器测试，包括离线/headless。
// 本模块必须在加载 Playwright 或其它浏览器驱动之前导入。
// 禁令未解除：无环境变量/命令行绕过选项；不得自动删除或修改此闸门。
// 这里只抛出错误，不启动、连接、监测或关闭任何浏览器，也不导入驱动。
const error = new Error('BROWSER_EXECUTION_BLOCKED：用户已禁止 Computer Use、Chrome 控制及浏览器测试。请仅做本地静态审计；查明并修正后仍须获得用户新的明确授权。');
error.code = 'BROWSER_EXECUTION_BLOCKED';
throw error;
