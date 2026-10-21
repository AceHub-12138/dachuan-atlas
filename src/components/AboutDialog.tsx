import { useEffect, useRef } from 'react';
import { CloseIcon } from './Icons';

interface AboutDialogProps {
  dataSource: 'demo' | 'nexus-snapshot';
  snapshot: { commitShort: string; generatedAt: string | null } | null;
  onClose: () => void;
  onOpenQuiz: () => void;
}

export function AboutDialog({ dataSource, snapshot, onClose, onOpenQuiz }: AboutDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    return () => previousFocus.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="about-dialog__head">
          <div>
            <span className="voice-panel__kicker">PROTOTYPE NOTES</span>
            <h2 id="about-title">原型说明</h2>
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="关闭原型说明">
            <CloseIcon />
          </button>
        </header>
        <div className="about-dialog__body">
          <p>
            DACHUAN ATLAS 是大川软件体系的<strong> P0.1 视觉原型 + P1.3 可信架构解释</strong>，用于评估星图视觉语言，并验证 Graphify 架构数据能否被可靠读取。
          </p>
          <p className="about-dialog__warning">
            模块位置、中枢连接、星点、轨道与流星仍是演示构图。只有本地导入快照后，画布才会绘制有证据的跨模块连线；连线是静态关系，不代表运行时调用顺序。
          </p>
          <dl>
            <div>
              <dt>如何探索</dt>
              <dd>悬停查看星系名称；点击 NEXUS 进入模块层；四个模块都可打开详情，并进入关系探索、架构投影与模块协作示意。</dd>
            </div>
            <div>
              <dt>数据来源</dt>
              <dd>
                {dataSource === 'nexus-snapshot' && snapshot
                  ? `当前查看本地导入的 NEXUS 历史快照 ${snapshot.commitShort}（${snapshot.generatedAt ?? '生成时间未知'}）。它只代表该历史提交，不代表当前工作区。`
                  : '当前为演示数据。点击右上角数据徽标，选择本地 .atlas.json 导入；Graphify 原始图需先在本地转换为 ATLAS 标准数据。'}
              </dd>
            </div>
            <div>
              <dt>动画强度</dt>
              <dd>右上角可在「完整 / 低动态 / 静态」之间切换。系统若启用减少动态效果，首次访问会使用静态模式。</dd>
            </div>
            <div>
              <dt>本轮范围</dt>
              <dd>P1.3 只读取本地导入的 NEXUS 历史快照；跨模块连线按直接提取 / 推断 / AI 复核 / 待核实区分线型。13 条关系为 AI 源码复核，0 条独立人工审核。模块协作示意是概念步骤，不是已验证的运行时顺序。不连接 Graphify Cloud，不上传内部代码。</dd>
            </div>
            <div>
              <dt>装饰效果</dt>
              <dd>星尘、流星以及模块外圈的微卫星与细轨道均为程序化装饰，不代表数据传输或真实架构关系，也不参与点击与详情。</dd>
            </div>
          </dl>
        </div>
        <footer className="about-dialog__footer">
          <span>DACHUAN ATLAS · v0.5.0 · P1.3</span>
          <span className="about-dialog__footer-actions">
            <button type="button" className="secondary-action" onClick={onOpenQuiz}>
              <span>做一次 5 题理解检查</span>
            </button>
            <span>Chrome / Edge · 桌面端</span>
          </span>
        </footer>
      </section>
    </div>
  );
}
