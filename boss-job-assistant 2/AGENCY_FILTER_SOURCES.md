# 自动批量猎头 / 外包暂缓名单

核对日期：2026-09-07。用途：执行用户“这些公司先跳过，手动去投”的个人批量投递偏好。不是声称名单内所有岗位均为外包合同，也不是公司信用评价。

| 暂缓组 | 匹配别名 | 公开一手依据 |
| --- | --- | --- |
| 科锐国际 | 科锐国际、科瑞国际、Career International | [官网招聘流程外包 RPO](https://www.careerintlinc.com/rpo.html) |
| 中软国际 | 中软国际、中软、Chinasoft International | [官网业务流程外包](https://www.chinasofti.com/outsourcing/) |
| 京北方 | 京北方、精北方、Northking | [官网公司介绍](https://www.northking.net/gywm.html)、[公开披露的 IT / BPO 业务说明](https://static.cninfo.com.cn/finalpage/2024-07-02/1220512792.PDF) |
| 软通动力 | 软通动力、iSoftStone | [官网全栈服务及驻场、离岸服务模式](https://www.isoftstone.com/zh-cn/htmls/quanzhanfuwu/index.html) |
| 文思海辉 | 文思海辉、Pactera | [官网外包管理解决方案](https://www.pactera.com/solution/multi-industry/OMM-solutions) |
| 法本信息 | 法本信息、Farben | [官网数字化运营服务](https://www.farben.com.cn/szhyyfw/) |
| 微创软件 | 微创软件、Wicresoft | [官网信息服务](https://www.wicresoft.com/informationServices.html)、[官网公司介绍](https://www.wicresoft.com/aboutUs.html) |

“科瑞国际”“精北方”保留用户原文作为额外匹配词；公开材料主体分别采用“科锐国际”“京北方”。不声称用户写法一定对应同一家主体。“中软”是用户明确要求的宽匹配。未将泛称“微创”加入，避免把微创医疗等无关公司也命中。

## 实际规则

1. 批量先检查左侧卡片公司和猎头标记；命中就直接登记公司 / 岗位 / 依据、跳过，不打开详情、不调用模型。
2. 读取新详情后，再检查列表公司、招聘者所属公司、明确猎头身份和明确本岗位外包 / 派遣说明；不要求左右公司名字相同。
3. 仅仅公司角色是 `multi_entity`、名字包含“信息 / 科技 / 咨询”、JD提及名单公司是客户或供应商，都不构成暂缓依据。
4. “非外包”“管理外包团队”不等于本岗位为外包；直营游戏软件测试仍按普通软件测试判断。
5. 名单按公司身份匹配，不在整段JD搜索公司名字。详细匹配结果写入运行日志，`agency_manual_only` 为错误码，`modelCalled: false` 表明这个筛选阶段未调用模型。
6. 名单只用于自动批量；用户仍可手动生成、确认并投递。手动操作仍受其他岗位、防重与平台限制规则约束。
7. 本文件不是可直接编辑的运行配置。运行名单在 `shared/core.js` 的 `AUTO_SKIP_COMPANIES`，修改后需重新加载扩展。

公开名单有限，不保证穷尽所有外包公司。未知公司只在页面有明确身份或岗位关系证据时自动暂缓，避免无依据扩大排除范围。
