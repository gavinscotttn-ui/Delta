package main

import (
	"fmt"
	"math"
	"runtime"
	"syscall"
	"unsafe"
)

// Core Audio via raw COM vtables (IMMDeviceEnumerator → IMMDevice → IAudioEndpointVolume).

var (
	clsidMMDeviceEnumerator = GUID{0xBCDE0395, 0xE52F, 0x467C, [8]byte{0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E}}
	iidIMMDeviceEnumerator  = GUID{0xA95664D2, 0x9614, 0x4F35, [8]byte{0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6}}
	iidIAudioEndpointVolume = GUID{0x5CDF2C82, 0x841E, 0x4546, [8]byte{0x97, 0x22, 0x0C, 0xF7, 0x40, 0x78, 0x22, 0x9A}}
)

const (
	eRender           = 0
	eCapture          = 1
	eConsole          = 0
	clsctxAll         = 0x17
	coinitMultithread = 0x0
	rpcEChangedMode   = 0x80010106

	// vtable slots
	vtRelease                 = 2
	vtGetDefaultAudioEndpoint = 4
	vtActivate                = 3
	vtSetMasterVolumeScalar   = 7
	vtGetMasterVolumeScalar   = 9
	vtSetMute                 = 14
	vtGetMute                 = 15
)

// comObj mirrors a COM interface pointer: its first field is the vtable pointer.
type comObj struct{ vtbl *[32]uintptr }

func (o *comObj) call(slot int, args ...uintptr) uintptr {
	r, _, _ := syscall.SyscallN(o.vtbl[slot], append([]uintptr{uintptr(unsafe.Pointer(o))}, args...)...)
	return r
}

func (o *comObj) release() {
	if o != nil {
		o.call(vtRelease)
	}
}

func hrErr(what string, hr uintptr) error {
	if int32(hr) >= 0 {
		return nil
	}
	return fmt.Errorf("%s failed (HRESULT 0x%08X)", what, uint32(hr))
}

// withEndpoint runs fn with the default render (speakers) or capture (mic) endpoint volume.
func withEndpoint(mic bool, fn func(vol *comObj) error) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	hr, _, _ := pCoInitializeEx.Call(0, coinitMultithread)
	if int32(hr) >= 0 {
		defer pCoUninitialize.Call()
	} else if uint32(hr) != rpcEChangedMode {
		return hrErr("CoInitializeEx", hr)
	}
	var enum *comObj
	hr, _, _ = pCoCreateInstance.Call(ptr(&clsidMMDeviceEnumerator), 0, clsctxAll, ptr(&iidIMMDeviceEnumerator), ptr(&enum))
	if err := hrErr("audio device enumerator", hr); err != nil {
		return err
	}
	defer enum.release()

	flow := uintptr(eRender)
	if mic {
		flow = eCapture
	}
	var dev *comObj
	hr = enum.call(vtGetDefaultAudioEndpoint, flow, eConsole, ptr(&dev))
	if int32(hr) < 0 {
		if mic {
			return fmt.Errorf("no default microphone (HRESULT 0x%08X)", uint32(hr))
		}
		return fmt.Errorf("no default speakers (HRESULT 0x%08X)", uint32(hr))
	}
	defer dev.release()

	var vol *comObj
	hr = dev.call(vtActivate, ptr(&iidIAudioEndpointVolume), clsctxAll, 0, ptr(&vol))
	if err := hrErr("activating endpoint volume", hr); err != nil {
		return err
	}
	defer vol.release()
	return fn(vol)
}

func audioGetMute(mic bool) (bool, error) {
	var m int32
	err := withEndpoint(mic, func(v *comObj) error { return hrErr("GetMute", v.call(vtGetMute, ptr(&m))) })
	return m != 0, err
}

func audioSetMute(mic, muted bool) error {
	return withEndpoint(mic, func(v *comObj) error { return hrErr("SetMute", v.call(vtSetMute, boolArg(muted), 0)) })
}

func audioGetVolume() (int, error) {
	var f float32
	err := withEndpoint(false, func(v *comObj) error {
		return hrErr("GetMasterVolumeLevelScalar", v.call(vtGetMasterVolumeScalar, ptr(&f)))
	})
	return int(math.Round(float64(f) * 100)), err
}

// audioSetVolume passes a float in an integer slot: the Go Windows syscall
// trampoline mirrors the first four args into XMM0-3, as the x64 ABI expects.
func audioSetVolume(pct int) error {
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	f := float32(pct) / 100
	return withEndpoint(false, func(v *comObj) error {
		return hrErr("SetMasterVolumeLevelScalar", v.call(vtSetMasterVolumeScalar, uintptr(math.Float32bits(f)), 0))
	})
}
