# 测评：把一整套科学计算工作站塞进浏览器，Ergalics Studio 实际体验如何

> 本文基于 Ergalics Studio 在线版（https://snowleopard-io.github.io/ErgalicsStudio/app/ ）的实际上手与源码阅读写成。项目开源，仓库在 GitHub 与 Gitee 同步维护。

「浏览器里跑科学计算」不是新概念——Jupyter 有官方在线服务，Google Colab 也运行多年。但这两个方案的思路都是"浏览器只是个壳，计算在云端"。Ergalics Studio 走的是另一条路：**全部计算发生在本地浏览器标签页里**，数据不上传，断网后已加载的功能仍然可用。这条路到底走通了没有，是本次测评想回答的问题。

## 先说结论

走通了，而且完成度超出预期。"拖入数据 → 看到图"的核心链路顺滑，插件生态初具规模，工程底子扎实。它当然还不是 Origin 或 MATLAB，但作为**交互式数据探索与科学演示工具**，已经是同类开源项目里相当能打的一个。值得 star，值得试用。

## 它是什么

一个纯前端实现的工作站：React 18 + TypeScript，计算层是 WebGPU（14 个可复用 WGSL 内核）加纯 TS 统计内核，Python 经 Pyodide 在 Web Worker 里跑完整 CPython，R 走内置的 webR 分发包。四种工作模式覆盖不同人群：

- **标准模式**：把 CSV、HDF5、NetCDF、FITS 等文件直接拖进窗口，按扩展名加魔数自动路由到匹配的插件出图。这是全项目体验最好的一环，第一次拖进去出图的时候会有"就这么简单？"的感觉。
- **流程模式**：38 种区块拼数据流管线，编译器做类型校验和拓扑排序，改单个节点只重跑下游，不是每次全量执行。
- **积木模式**：类 Scratch 的 Blockly 编辑器，面向教学场景。
- **代码模式**：Monaco 编辑器跑 Python / R / JS，比较有想象力的一点是三种语言共享一套中间表示（IR），切换语言时代码可以互译——包括积木和流程图，也能和代码双向转换。

插件规模是 107 个（97 个科学插件 + 10 个趣味工具），按 16 个学科分组，另有 26 个独立科研工具（不确定性传播、MCMC 贝叶斯推断、ONNX 模型推理等）可以内嵌进工作台。随仓库附带 138 个示例数据集和 11 个示例工程，上手零门槛。

![标准模式](https://gitee.com/cnt-code/ergalics-studio/raw/main/docs/assets/screenshots/platform/mode-standard-welcome.png)

## 插件库巡礼：各学科长什么样

光说"107 个插件、16 个学科"太抽象，直接看图。以下均来自仓库内置插件的实际运行截图：

**物理 · 薛定谔方程**——绘制波函数与概率密度，量子力学教学里最抽象的东西直接可视化：

![物理：薛定谔方程](https://gitee.com/cnt-code/ergalics-studio/raw/main/docs/assets/screenshots/plugins/physics-schrodinger.png)

**化学 · 滴定曲线**——调节参数实时观察 pH 曲线与突跃位置：

![化学：滴定曲线](https://gitee.com/cnt-code/ergalics-studio/raw/main/docs/assets/screenshots/plugins/chem-titration.png)

**生物 · SEIR 传染病模型**——舱室模型参数可调，疫情传播动力学一目了然：

![生物：SEIR 传染病模型](https://gitee.com/cnt-code/ergalics-studio/raw/main/docs/assets/screenshots/plugins/bio-epidemic/seir.png)

**天文 · 赫罗图**——恒星光度-温度分布，天文学的经典图式：

![天文：赫罗图](https://gitee.com/cnt-code/ergalics-studio/raw/main/docs/assets/screenshots/plugins/astro-hrdiagram.png)

**数学 · 傅里叶分析**——时域信号到频域分解的动态演示：

![数学：傅里叶分析](https://gitee.com/cnt-code/ergalics-studio/raw/main/docs/assets/screenshots/plugins/math-fourier.png)

**材料学 · XRD 衍射谱**——调整晶格参数观察衍射峰位变化：

![材料学：XRD 衍射谱](https://gitee.com/cnt-code/ergalics-studio/raw/main/docs/assets/screenshots/plugins/mats-xrd.png)

**经济与金融 · Black-Scholes 期权定价**——期权价格对波动率、到期时间的敏感性曲面：

![经济金融：Black-Scholes](https://gitee.com/cnt-code/ergalics-studio/raw/main/docs/assets/screenshots/plugins/econ-blackscholes.png)

**工程仿真 · 流固耦合 CFD**——26 个科研工具之外的求解器级插件，输出场量、时间序列与权衡曲线，接近小型仿真软件的输出规格：

![工程仿真：流固耦合 CFD](https://gitee.com/cnt-code/ergalics-studio/raw/main/docs/assets/screenshots/plugins/fluid-cfd-coupler/field-voxels-case-a.png)

值得注意的是，这些插件的图不是静态素材——每个都可以改参数重算，且都接入前文提到的科学输出栏，图下面跟着数值结论。

## 亮点：四个不像"学生项目"的设计

**1. 科研级插件有元数据契约。** 每个科学插件声明自己的就绪分级（研究级 / 准研究级 / 演示级 / 教学演示）、物理量单位和内置验证基准，在市场里用徽章区分。更重要的是统一科学输出栏：插件不只出图，还会发布 R²、RMSE、置信区间、收敛诊断这类结构化结论，图和数值结论绑定呈现。这个设计对教学和科研复现都是实打实的加分。

**2. 浏览器内 Git 是真实现而非摆设。** 基于 isomorphic-git + IndexedDB，init / commit / branch / diff / push 都在工作台侧边栏里完成，项目文件和 Git 工作区共享同一份虚拟文件系统。虽然 push 需要配置 CORS 代理，但"数据分析和版本控制不离开浏览器"这件事本身是完整的。

**3. 可复现性内核。** 带种子的随机数、稳定哈希、运行清单、`repro.lock`、DAG 导出为 Python 脚本。做科研的人都知道"这图怎么复现出来"有多痛，一个前端项目认真做这块是罕见的。

**4. 工程质量在开源前端项目里属于上游水平。** TypeScript strict 全开，43 个 core 子目录 + 38 个根级模块分层清晰，Vitest 单元测试覆盖核心内核，Playwright 做 E2E，三语言 IR 往返正确性由测试固化。中英双语、暗亮主题、性能监控面板这些"面子工程"也一个不落。翻源码的时候能感受到这不是一次性Demo，而是按长期项目标准在写。

## 使用前值得知道的几点

这些不是致命伤，但提前了解能少走弯路：

- **WebGPU 兼容性**：GPU 加速路径目前主要在 Chrome / Edge 下体验最佳，Safari 和 Firefox 支持不完整。项目有 CPU 回退保证功能可用，重度使用前先跑一遍欢迎页的硬件自检。
- **首屏加载**：Pyodide、webR 等运行时是懒加载的，首次触发需要下载几十 MB 依赖，建议网络好的时候先加载一次，之后有浏览器缓存。
- **数据规模**：受浏览器标签页内存限制，数百 MB 以上的数据集不适用。HDF5 已支持分块读取缓解，但超大场景还是建议走桌面端专业软件。
- **插件深度**：107 个插件覆盖 16 个学科，胜在广度；单个演示级插件的功能深度有限，选插件时看一眼元数据徽章就能判断它是否够用。

![流程模式](https://gitee.com/cnt-code/ergalics-studio/raw/main/docs/assets/screenshots/platform/mode-flow.png)

## 适合谁用

- **学生和研究者**：需要快速看一眼数据长什么样、做个初步探索，免安装直接拖文件。
- **物理 / 化学老师**：找一个免维护、打开就能用的课堂演示工具，插件库基本覆盖了高中到本科的演示需求。
- **前端开发者**：想看 WebGPU 计算管线、浏览器内沙箱、isomorphic-git、三语言 IR 互译这些技术怎么落地——这个仓库本身就是一份很好的参考实现。

## 结尾

Ergalics Studio 最有价值的地方不是某个单项功能，而是它验证了一件事：在一台不装任何软件的电脑上，打开网页就能完成"导入科研格式数据 → 统计分析 → GPU 加速计算 → 出版级出图 → Git 版本控制"的完整链路。链路上每个环节都还有成长空间，但整条链路是通的、开源的、MIT 协议的，而且数据始终不出本地——这在教育场景和隐私敏感场景里是刚需属性。

项目地址（Gitee）：https://gitee.com/cnt-code/ergalics-studio
在线试用：https://snowleopard-io.github.io/ErgalicsStudio/app/

如果这篇文章对你有用，去仓库点个 star 就是对独立开发者最直接的支持。
