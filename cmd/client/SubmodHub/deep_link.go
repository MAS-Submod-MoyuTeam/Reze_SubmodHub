package main

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// DeepLinkEventName 是「请前端打开这个 mod 详情」的实时通道。
// 前端订阅它（clients/desktop/src/App.tsx），订阅后自己决定怎么打开。
const DeepLinkEventName = "submodhub:deep_link"

// singleInstanceID 让「再点一次链接」回到已在运行的进程，而不是开第二个窗口。
const singleInstanceID = "com.reze.submodhub"

// modLinkInbox 存住「已经解析出 mod id、但前端可能还没准备好接收」的深链。
//
// 冷启动时链接是进程的第一个参数，那一刻页面还不存在；Android 也可能在页面加载
// 完成前就收到 intent。所以既发事件、也留一份待领取：前端挂载后调用
// TakePendingModLink 取走并在同一轮打开，事件丢了也不会漏掉这次点击。
type modLinkInbox struct {
	mu      sync.Mutex
	pending string
}

func (b *modLinkInbox) put(modID string) {
	if modID == "" {
		return
	}
	b.mu.Lock()
	b.pending = modID
	b.mu.Unlock()
}

// take 取走并清空：一次点击只应打开一次详情，刷新页面不该再跳一遍。
func (b *modLinkInbox) take() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	id := b.pending
	b.pending = ""
	return id
}

var pendingModLinks modLinkInbox

// deliverModLink 解析一条链接并交给客户端，返回其中的 mod id（无链接时为空串）。
//
// 窗口已存在时把窗口提到前台并实时通知前端——用户点链接时期待的是「客户端跳到
// 这个详情」，而不是在后台悄悄记一笔。
func deliverModLink(raw string) string {
	modID, ok := parseModLink(raw)
	if !ok {
		return ""
	}
	pendingModLinks.put(modID)
	if app := application.Get(); app != nil {
		if window := app.Window.Current(); window != nil {
			window.Restore()
			window.Focus()
			window.EmitEvent(DeepLinkEventName, map[string]any{"mod_id": modID})
		}
	}
	return modID
}

// TakePendingModLink 由前端在挂载后调用：领走页面就绪前到达的深链。
func (s *DesktopService) TakePendingModLink() string {
	return pendingModLinks.take()
}

// ClipboardModLink 报告剪贴板里是否是一条站内 mod 链接，命中则返回 mod id。
// 前端只在「启动后」与「窗口重新获得焦点」这两个时刻调用它：Android 10+ 只有
// 前台应用能读剪贴板，定时轮询既拿不到数据，也违背系统对剪贴板的限制。
func (s *DesktopService) ClipboardModLink() string {
	app := application.Get()
	if app == nil || app.Clipboard == nil {
		return ""
	}
	text, ok := app.Clipboard.Text()
	if !ok {
		return ""
	}
	modID, found := parseModLink(text)
	if !found {
		return ""
	}
	return modID
}

// ModShareLink 产出写进剪贴板的分享链接：可以直接粘到浏览器，也会被本客户端
// 自己识别成站内链接。规则与 web 端 modShareURL 一致，两端不各写一种链接。
func (s *DesktopService) ModShareLink(modID string) (string, error) {
	if !isModID(modID) {
		return "", errInvalidModID
	}
	return modShareURL(modID), nil
}
