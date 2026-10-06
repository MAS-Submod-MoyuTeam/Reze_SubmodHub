import { WML } from "@wailsio/runtime";
import { GetMASStatus, SetMASRoot } from "../bindings/github.com/reze/submodhub/cmd/client/desktopservice.js";

WML.Enable();
const result = document.getElementById('result')!;
const rootInput = document.getElementById('name')! as HTMLInputElement;
const action = document.getElementById('greet')! as HTMLButtonElement;
const title = document.querySelector('.title-name')!;
title.textContent = 'SubmodHub PC';
rootInput.value = 'E:\\MAS_Cn001280\\MAS_CN0012F0';
action.textContent = '验证 MAS';
action.addEventListener('click', async () => {
  try {
    const status = await SetMASRoot(rootInput.value);
    result.textContent = status.valid && status.game_exists ? `已连接：${status.submods} 个模组目录` : '目录无效：需要包含 game 目录';
  } catch (error) {
    result.textContent = `验证失败：${error instanceof Error ? error.message : String(error)}`;
  }
});
void GetMASStatus().then((status) => { result.textContent = status.valid ? `当前 MAS：${status.root}` : '尚未验证 MAS 目录'; }).catch(() => { result.textContent = '尚未验证 MAS 目录'; });
