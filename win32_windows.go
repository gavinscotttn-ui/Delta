package main

import (
	"syscall"
	"unsafe"
)

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	shell32  = syscall.NewLazyDLL("shell32.dll")
	ole32    = syscall.NewLazyDLL("ole32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")
	advapi32 = syscall.NewLazyDLL("advapi32.dll")
	dwmapi   = syscall.NewLazyDLL("dwmapi.dll")

	pRegisterClassExW          = user32.NewProc("RegisterClassExW")
	pCreateWindowExW           = user32.NewProc("CreateWindowExW")
	pDestroyWindow             = user32.NewProc("DestroyWindow")
	pDefWindowProcW            = user32.NewProc("DefWindowProcW")
	pGetMessageW               = user32.NewProc("GetMessageW")
	pTranslateMessage          = user32.NewProc("TranslateMessage")
	pDispatchMessageW          = user32.NewProc("DispatchMessageW")
	pPostMessageW              = user32.NewProc("PostMessageW")
	pPostQuitMessage           = user32.NewProc("PostQuitMessage")
	pRegisterWindowMessageW    = user32.NewProc("RegisterWindowMessageW")
	pRegisterHotKey            = user32.NewProc("RegisterHotKey")
	pUnregisterHotKey          = user32.NewProc("UnregisterHotKey")
	pEnumWindows               = user32.NewProc("EnumWindows")
	pEnumDisplayMonitors       = user32.NewProc("EnumDisplayMonitors")
	pGetMonitorInfoW           = user32.NewProc("GetMonitorInfoW")
	pIsWindowVisible           = user32.NewProc("IsWindowVisible")
	pIsWindow                  = user32.NewProc("IsWindow")
	pIsIconic                  = user32.NewProc("IsIconic")
	pIsZoomed                  = user32.NewProc("IsZoomed")
	pGetWindow                 = user32.NewProc("GetWindow")
	pGetWindowLongPtrW         = user32.NewProc("GetWindowLongPtrW")
	pGetWindowTextW            = user32.NewProc("GetWindowTextW")
	pGetWindowTextLengthW      = user32.NewProc("GetWindowTextLengthW")
	pGetClassNameW             = user32.NewProc("GetClassNameW")
	pGetWindowThreadProcessId  = user32.NewProc("GetWindowThreadProcessId")
	pShowWindow                = user32.NewProc("ShowWindow")
	pSetWindowPos              = user32.NewProc("SetWindowPos")
	pGetWindowRect             = user32.NewProc("GetWindowRect")
	pGetWindowPlacement        = user32.NewProc("GetWindowPlacement")
	pSetWindowPlacement        = user32.NewProc("SetWindowPlacement")
	pGetForegroundWindow       = user32.NewProc("GetForegroundWindow")
	pSetForegroundWindow       = user32.NewProc("SetForegroundWindow")
	pBringWindowToTop          = user32.NewProc("BringWindowToTop")
	pAttachThreadInput         = user32.NewProc("AttachThreadInput")
	pSendInput                 = user32.NewProc("SendInput")
	pLockWorkStation           = user32.NewProc("LockWorkStation")
	pOpenClipboard             = user32.NewProc("OpenClipboard")
	pEmptyClipboard            = user32.NewProc("EmptyClipboard")
	pCloseClipboard            = user32.NewProc("CloseClipboard")
	pCreatePopupMenu           = user32.NewProc("CreatePopupMenu")
	pAppendMenuW               = user32.NewProc("AppendMenuW")
	pTrackPopupMenu            = user32.NewProc("TrackPopupMenu")
	pDestroyMenu               = user32.NewProc("DestroyMenu")
	pGetCursorPos              = user32.NewProc("GetCursorPos")
	pLoadImageW                = user32.NewProc("LoadImageW")
	pLoadIconW                 = user32.NewProc("LoadIconW")
	pLoadCursorW               = user32.NewProc("LoadCursorW")
	pMessageBoxW               = user32.NewProc("MessageBoxW")
	pBeginPaint                = user32.NewProc("BeginPaint")
	pEndPaint                  = user32.NewProc("EndPaint")
	pFillRect                  = user32.NewProc("FillRect")
	pDrawTextW                 = user32.NewProc("DrawTextW")
	pGetClientRect             = user32.NewProc("GetClientRect")
	pSetLayeredWindowAttrs     = user32.NewProc("SetLayeredWindowAttributes")
	pSetTimer                  = user32.NewProc("SetTimer")
	pKillTimer                 = user32.NewProc("KillTimer")
	pSetProcessDpiAwarenessCtx = user32.NewProc("SetProcessDpiAwarenessContext")

	pGetModuleHandleW           = kernel32.NewProc("GetModuleHandleW")
	pCreateMutexW               = kernel32.NewProc("CreateMutexW")
	pOpenProcess                = kernel32.NewProc("OpenProcess")
	pQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
	pCloseHandle                = kernel32.NewProc("CloseHandle")
	pGetCurrentThreadId         = kernel32.NewProc("GetCurrentThreadId")
	pGetCurrentProcessId        = kernel32.NewProc("GetCurrentProcessId")

	pShellNotifyIconW = shell32.NewProc("Shell_NotifyIconW")
	pShellExecuteW    = shell32.NewProc("ShellExecuteW")

	pCoInitializeEx   = ole32.NewProc("CoInitializeEx")
	pCoUninitialize   = ole32.NewProc("CoUninitialize")
	pCoCreateInstance = ole32.NewProc("CoCreateInstance")

	pCreateSolidBrush = gdi32.NewProc("CreateSolidBrush")
	pCreateFontW      = gdi32.NewProc("CreateFontW")
	pSelectObject     = gdi32.NewProc("SelectObject")
	pDeleteObject     = gdi32.NewProc("DeleteObject")
	pSetTextColor     = gdi32.NewProc("SetTextColor")
	pSetBkMode        = gdi32.NewProc("SetBkMode")

	pRegOpenKeyExW   = advapi32.NewProc("RegOpenKeyExW")
	pRegSetValueExW  = advapi32.NewProc("RegSetValueExW")
	pRegDeleteValueW = advapi32.NewProc("RegDeleteValueW")
	pRegCloseKey     = advapi32.NewProc("RegCloseKey")

	pDwmGetWindowAttribute = dwmapi.NewProc("DwmGetWindowAttribute")
)

const (
	WM_DESTROY       = 0x0002
	WM_PAINT         = 0x000F
	WM_CLOSE         = 0x0010
	WM_COMMAND       = 0x0111
	WM_SYSCOMMAND    = 0x0112
	WM_TIMER         = 0x0113
	WM_HOTKEY        = 0x0312
	WM_NULL          = 0x0000
	WM_LBUTTONUP     = 0x0202
	WM_LBUTTONDBLCLK = 0x0203
	WM_RBUTTONUP     = 0x0205
	WM_CONTEXTMENU   = 0x007B
	WM_APP           = 0x8000

	WM_APP_CALL = WM_APP + 1
	WM_APP_TRAY = WM_APP + 2

	SW_HIDE            = 0
	SW_SHOWNORMAL      = 1
	SW_SHOWMINIMIZED   = 2
	SW_MAXIMIZE        = 3
	SW_SHOWNOACTIVATE  = 4
	SW_SHOW            = 5
	SW_MINIMIZE        = 6
	SW_SHOWMINNOACTIVE = 7
	SW_RESTORE         = 9

	SWP_NOSIZE       = 0x0001
	SWP_NOMOVE       = 0x0002
	SWP_NOZORDER     = 0x0004
	SWP_NOACTIVATE   = 0x0010
	SWP_FRAMECHANGED = 0x0020
	SWP_SHOWWINDOW   = 0x0040

	GW_OWNER          = 4
	GWL_EXSTYLE       = -20
	WS_EX_TOOLWINDOW  = 0x00000080
	WS_EX_TOPMOST     = 0x00000008
	WS_EX_LAYERED     = 0x00080000
	WS_EX_NOACTIVATE  = 0x08000000
	WS_EX_TRANSPARENT = 0x00000020
	WS_POPUP          = 0x80000000

	MOD_NOREPEAT = 0x4000

	NIM_ADD      = 0
	NIM_MODIFY   = 1
	NIM_DELETE   = 2
	NIF_MESSAGE  = 0x1
	NIF_ICON     = 0x2
	NIF_TIP      = 0x4
	NIF_INFO     = 0x10
	NIIF_USER    = 0x4
	NIIF_NOSOUND = 0x10

	MF_STRING       = 0x0
	MF_SEPARATOR    = 0x800
	MF_CHECKED      = 0x8
	MF_GRAYED       = 0x1
	TPM_RETURNCMD   = 0x0100
	TPM_RIGHTBUTTON = 0x0002
	TPM_BOTTOMALIGN = 0x0020

	IMAGE_ICON     = 1
	LR_DEFAULTSIZE = 0x40
	LR_SHARED      = 0x8000

	INPUT_KEYBOARD        = 1
	KEYEVENTF_EXTENDEDKEY = 0x1
	KEYEVENTF_KEYUP       = 0x2
	KEYEVENTF_UNICODE     = 0x4

	PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
	ERROR_ALREADY_EXISTS              = 183

	HKEY_CURRENT_USER = 0x80000001
	KEY_SET_VALUE     = 0x0002
	REG_SZ            = 1

	MB_OK        = 0x0
	MB_ICONERROR = 0x10
	MB_TOPMOST   = 0x40000

	DT_CENTER     = 0x1
	DT_VCENTER    = 0x4
	DT_SINGLELINE = 0x20
	TRANSPARENT   = 1
	LWA_ALPHA     = 0x2

	DWMWA_CLOAKED = 14
)

type RECT struct{ Left, Top, Right, Bottom int32 }
type POINT struct{ X, Y int32 }

type MSG struct {
	Hwnd     uintptr
	Message  uint32
	WParam   uintptr
	LParam   uintptr
	Time     uint32
	Pt       POINT
	LPrivate uint32
}

type WNDCLASSEXW struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     uintptr
	HIcon         uintptr
	HCursor       uintptr
	HbrBackground uintptr
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       uintptr
}

type MONITORINFOEXW struct {
	CbSize    uint32
	RcMonitor RECT
	RcWork    RECT
	DwFlags   uint32
	SzDevice  [32]uint16
}

type WINDOWPLACEMENT struct {
	Length           uint32
	Flags            uint32
	ShowCmd          uint32
	PtMinPosition    POINT
	PtMaxPosition    POINT
	RcNormalPosition RECT
}

type GUID struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

type NOTIFYICONDATAW struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         GUID
	HBalloonIcon     uintptr
}

type KEYBDINPUT struct {
	Vk        uint16
	Scan      uint16
	Flags     uint32
	Time      uint32
	ExtraInfo uintptr
}

// INPUT is 40 bytes on amd64: type (4) + padding (4) + 32-byte union.
type INPUT struct {
	Type uint32
	_    uint32
	Ki   KEYBDINPUT
	_    [8]byte
}

type PAINTSTRUCT struct {
	Hdc         uintptr
	FErase      int32
	RcPaint     RECT
	FRestore    int32
	FIncUpdate  int32
	RgbReserved [32]byte
}

func u16(s string) *uint16 {
	p, err := syscall.UTF16PtrFromString(s)
	if err != nil {
		p, _ = syscall.UTF16PtrFromString("")
	}
	return p
}

func copyU16(dst []uint16, s string) {
	src, _ := syscall.UTF16FromString(s)
	if len(src) > len(dst) {
		src = src[:len(dst)]
		src[len(src)-1] = 0
	}
	copy(dst, src)
}

func ptr[T any](p *T) uintptr { return uintptr(unsafe.Pointer(p)) }

func boolArg(b bool) uintptr {
	if b {
		return 1
	}
	return 0
}

func messageBox(title, text string, flags uintptr) {
	pMessageBoxW.Call(0, uintptr(unsafe.Pointer(u16(text))), uintptr(unsafe.Pointer(u16(title))), flags)
}
