"""Generate the 2.0 voice catalog and emit a SQL UPDATE for `system_settings`.

Run locally: `python migrate_voices_to_2_0.py [--sql /tmp/update_voices.sql]
[--json /tmp/voices.json] [--py /tmp/fallback.py]`.

This script is the single source of truth for the post-2026-05-15 Volcano TTS
2.0 (`*_uranus_bigtts` / `saturn_*_tob`) voice list. The Anthropic-spelled
sources are inline below — keep them in sync with the Volcano console; do NOT
hand-edit the DB or the YAML.

Outputs are deliberately split so each landing surface (DB row, fallback
catalog in tts_service.py, alembic seed) can be regenerated identically.
"""

import argparse
import json
from typing import Optional


# voice_type | display_name | category | language_label
VOICES: list[tuple[str, str, str, str]] = [
    ("zh_female_vv_uranus_bigtts", "Vivi 2.0", "通用场景", "中文/日文/印尼/墨西哥西班牙语"),
    ("zh_female_xiaohe_uranus_bigtts", "小何 2.0", "通用场景", "中文"),
    ("zh_male_m191_uranus_bigtts", "云舟 2.0", "通用场景", "中文"),
    ("zh_male_taocheng_uranus_bigtts", "小天 2.0", "通用场景", "中文"),
    ("zh_male_liufei_uranus_bigtts", "刘飞 2.0", "通用场景", "中文"),
    ("zh_female_sophie_uranus_bigtts", "魅力苏菲 2.0", "通用场景", "中文"),
    ("zh_female_qingxinnvsheng_uranus_bigtts", "清新女声 2.0", "通用场景", "中文"),
    ("zh_female_cancan_uranus_bigtts", "知性灿灿 2.0", "角色扮演", "中文"),
    ("zh_female_sajiaoxuemei_uranus_bigtts", "撒娇学妹 2.0", "角色扮演", "中文"),
    ("zh_female_tianmeixiaoyuan_uranus_bigtts", "甜美小源 2.0", "通用场景", "中文"),
    ("zh_female_tianmeitaozi_uranus_bigtts", "甜美桃子 2.0", "通用场景", "中文"),
    ("zh_female_shuangkuaisisi_uranus_bigtts", "爽快思思 2.0", "通用场景", "中文"),
    ("zh_female_peiqi_uranus_bigtts", "佩奇猪 2.0", "视频配音", "中文"),
    ("zh_female_linjianvhai_uranus_bigtts", "邻家女孩 2.0", "通用场景", "中文"),
    ("zh_male_shaonianzixin_uranus_bigtts", "少年梓辛/Brayan 2.0", "通用场景", "中文"),
    ("zh_male_sunwukong_uranus_bigtts", "猴哥 2.0", "视频配音", "中文"),
    ("zh_female_yingyujiaoxue_uranus_bigtts", "Tina老师 2.0", "教育场景", "中文/英式英语"),
    ("zh_female_kefunvsheng_uranus_bigtts", "暖阳女声 2.0", "客服场景", "中文"),
    ("zh_female_xiaoxue_uranus_bigtts", "儿童绘本 2.0", "有声阅读", "中文"),
    ("zh_male_dayi_uranus_bigtts", "大壹 2.0", "视频配音", "中文"),
    ("zh_female_mizai_uranus_bigtts", "黑猫侦探社咪仔 2.0", "视频配音", "中文"),
    ("zh_female_jitangnv_uranus_bigtts", "鸡汤女 2.0", "视频配音", "中文"),
    ("zh_female_meilinvyou_uranus_bigtts", "魅力女友 2.0", "通用场景", "中文"),
    ("zh_female_liuchangnv_uranus_bigtts", "流畅女声 2.0", "视频配音", "中文"),
    ("zh_male_ruyayichen_uranus_bigtts", "儒雅逸辰 2.0", "视频配音", "中文"),
    ("en_male_tim_uranus_bigtts", "Tim", "多语种", "美式英语"),
    ("en_female_dacey_uranus_bigtts", "Dacey", "多语种", "美式英语"),
    ("en_female_stokie_uranus_bigtts", "Stokie", "多语种", "美式英语"),
    ("zh_female_wenroumama_uranus_bigtts", "温柔妈妈 2.0", "通用场景", "中文"),
    ("zh_male_jieshuoxiaoming_uranus_bigtts", "解说小明 2.0", "通用场景", "中文"),
    ("zh_female_tvbnv_uranus_bigtts", "TVB女声 2.0", "通用场景", "中文"),
    ("zh_male_yizhipiannan_uranus_bigtts", "译制片男 2.0", "通用场景", "中文"),
    ("zh_female_qiaopinv_uranus_bigtts", "俏皮女声 2.0", "通用场景", "中文"),
    ("zh_female_zhishuaiyingzi_uranus_bigtts", "直率英子 2.0", "角色扮演", "中文"),
    ("zh_male_linjiananhai_uranus_bigtts", "邻家男孩 2.0", "通用场景", "中文"),
    ("zh_male_silang_uranus_bigtts", "四郎 2.0", "角色扮演", "中文"),
    ("zh_male_ruyaqingnian_uranus_bigtts", "儒雅青年 2.0", "通用场景", "中文"),
    ("zh_male_qingcang_uranus_bigtts", "擎苍 2.0", "角色扮演", "中文"),
    ("zh_male_xionger_uranus_bigtts", "熊二 2.0", "角色扮演", "中文"),
    ("zh_female_yingtaowanzi_uranus_bigtts", "樱桃丸子 2.0", "角色扮演", "中文"),
    ("zh_male_wennuanahu_uranus_bigtts", "温暖阿虎/Alvin 2.0", "通用场景", "中文"),
    ("zh_male_naiqimengwa_uranus_bigtts", "奶气萌娃 2.0", "通用场景", "中文"),
    ("zh_female_popo_uranus_bigtts", "婆婆 2.0", "通用场景", "中文"),
    ("zh_female_gaolengyujie_uranus_bigtts", "高冷御姐 2.0", "通用场景", "中文"),
    ("zh_male_aojiaobazong_uranus_bigtts", "傲娇霸总 2.0", "通用场景", "中文"),
    ("zh_male_lanyinmianbao_uranus_bigtts", "懒音绵宝 2.0", "角色扮演", "中文"),
    ("zh_male_fanjuanqingnian_uranus_bigtts", "反卷青年 2.0", "通用场景", "中文"),
    ("zh_female_wenroushunv_uranus_bigtts", "温柔淑女 2.0", "通用场景", "中文"),
    ("zh_female_gufengshaoyu_uranus_bigtts", "古风少御 2.0", "角色扮演", "中文"),
    ("zh_male_huolixiaoge_uranus_bigtts", "活力小哥 2.0", "通用场景", "中文"),
    ("zh_male_baqiqingshu_uranus_bigtts", "霸气青叔 2.0", "有声阅读", "中文"),
    ("zh_male_xuanyijieshuo_uranus_bigtts", "悬疑解说 2.0", "有声阅读", "中文"),
    ("zh_female_mengyatou_uranus_bigtts", "萌丫头/Cutey 2.0", "通用场景", "中文"),
    ("zh_female_tiexinnvsheng_uranus_bigtts", "贴心女声/Candy 2.0", "通用场景", "中文"),
    ("zh_female_jitangmei_uranus_bigtts", "鸡汤妹妹/Hope 2.0", "通用场景", "中文"),
    ("zh_male_cixingjieshuonan_uranus_bigtts", "磁性解说男声/Morgan 2.0", "通用场景", "中文"),
    ("zh_male_liangsangmengzai_uranus_bigtts", "亮嗓萌仔 2.0", "通用场景", "中文"),
    ("zh_female_kailangjiejie_uranus_bigtts", "开朗姐姐 2.0", "通用场景", "中文"),
    ("zh_male_gaolengchenwen_uranus_bigtts", "高冷沉稳 2.0", "通用场景", "中文"),
    ("zh_male_shenyeboke_uranus_bigtts", "深夜播客 2.0", "通用场景", "中文"),
    ("zh_male_lubanqihao_uranus_bigtts", "鲁班七号 2.0", "角色扮演", "中文"),
    ("zh_female_jiaochuannv_uranus_bigtts", "娇喘女声 2.0", "通用场景", "中文"),
    ("zh_female_linxiao_uranus_bigtts", "林潇 2.0", "角色扮演", "中文"),
    ("zh_female_lingling_uranus_bigtts", "玲玲姐姐 2.0", "角色扮演", "中文"),
    ("zh_female_chunribu_uranus_bigtts", "春日部姐姐 2.0", "角色扮演", "中文"),
    ("zh_male_tangseng_uranus_bigtts", "唐僧 2.0", "角色扮演", "中文"),
    ("zh_male_zhuangzhou_uranus_bigtts", "庄周 2.0", "角色扮演", "中文"),
    ("zh_male_kailangdidi_uranus_bigtts", "开朗弟弟 2.0", "通用场景", "中文"),
    ("zh_male_zhubajie_uranus_bigtts", "猪八戒 2.0", "角色扮演", "中文"),
    ("zh_female_ganmaodianyin_uranus_bigtts", "感冒电音姐姐 2.0", "角色扮演", "中文"),
    ("zh_female_chanmeinv_uranus_bigtts", "谄媚女声 2.0", "通用场景", "中文"),
    ("zh_female_nvleishen_uranus_bigtts", "女雷神 2.0", "角色扮演", "中文"),
    ("zh_female_qinqienv_uranus_bigtts", "亲切女声 2.0", "通用场景", "中文"),
    ("zh_male_kuailexiaodong_uranus_bigtts", "快乐小东 2.0", "通用场景", "中文"),
    ("zh_male_kailangxuezhang_uranus_bigtts", "开朗学长 2.0", "通用场景", "中文"),
    ("zh_male_youyoujunzi_uranus_bigtts", "悠悠君子 2.0", "通用场景", "中文"),
    ("zh_female_wenjingmaomao_uranus_bigtts", "文静毛毛 2.0", "通用场景", "中文"),
    ("zh_female_zhixingnv_uranus_bigtts", "知性女声 2.0", "通用场景", "中文"),
    ("zh_male_qingshuangnanda_uranus_bigtts", "清爽男大 2.0", "通用场景", "中文"),
    ("zh_male_yuanboxiaoshu_uranus_bigtts", "渊博小叔 2.0", "通用场景", "中文"),
    ("zh_male_yangguangqingnian_uranus_bigtts", "阳光青年 2.0", "通用场景", "中文"),
    ("zh_female_qingchezizi_uranus_bigtts", "清澈梓梓 2.0", "通用场景", "中文"),
    ("zh_female_tianmeiyueyue_uranus_bigtts", "甜美悦悦 2.0", "通用场景", "中文"),
    ("zh_female_xinlingjitang_uranus_bigtts", "心灵鸡汤 2.0", "通用场景", "中文"),
    ("zh_male_wenrouxiaoge_uranus_bigtts", "温柔小哥 2.0", "通用场景", "中文"),
    ("zh_female_roumeinvyou_uranus_bigtts", "柔美女友 2.0", "通用场景", "中文"),
    ("zh_male_dongfanghaoran_uranus_bigtts", "东方浩然 2.0", "通用场景", "中文"),
    ("zh_female_wenrouxiaoya_uranus_bigtts", "温柔小雅 2.0", "通用场景", "中文"),
    ("zh_male_tiancaitongsheng_uranus_bigtts", "天才童声 2.0", "通用场景", "中文"),
    ("zh_female_wuzetian_uranus_bigtts", "武则天 2.0", "角色扮演", "中文"),
    ("zh_female_gujie_uranus_bigtts", "顾姐 2.0", "角色扮演", "中文"),
    ("zh_male_guanggaojieshuo_uranus_bigtts", "广告解说 2.0", "通用场景", "中文"),
    ("zh_female_shaoergushi_uranus_bigtts", "少儿故事 2.0", "有声阅读", "中文"),
    # ── saturn (saturn line, 2.0 generation, COT/QA能力) ──
    ("saturn_zh_female_tiaopigongzhu_tob", "调皮公主", "角色扮演", "中文"),
    ("saturn_zh_female_keainvsheng_tob", "可爱女生", "角色扮演", "中文"),
    ("saturn_zh_male_shuanglangshaonian_tob", "爽朗少年", "角色扮演", "中文"),
    ("saturn_zh_male_tiancaitongzhuo_tob", "天才同桌", "角色扮演", "中文"),
    ("saturn_zh_female_cancan_tob", "知性灿灿", "角色扮演", "中文"),
    ("saturn_zh_female_qingyingduoduo_cs_tob", "轻盈朵朵 2.0", "客服场景", "中文"),
    ("saturn_zh_female_wenwanshanshan_cs_tob", "温婉珊珊 2.0", "客服场景", "中文"),
    ("saturn_zh_female_reqingaina_cs_tob", "热情艾娜 2.0", "客服场景", "中文"),
    ("saturn_zh_male_qingxinmumu_cs_tob", "清新沐沐 2.0", "客服场景", "中文"),
]


def derive_gender(voice_id: str) -> str:
    """Voice id encodes gender between language prefix and name. `zh_female_*`,
    `en_male_*`, `saturn_zh_female_*`, etc. Falls back to 'unknown'.
    """
    for token in ("_female_", "_male_"):
        if token in voice_id:
            return token.strip("_")
    return "unknown"


def derive_language(voice_id: str, language_label: str) -> str:
    """Match the legacy DB shape: BCP-47 ISO code in the `language` field.
    `language_label` (the human label) is preserved in `description`.
    """
    if voice_id.startswith("en_"):
        return "en-US"
    return "zh-CN"


def voice_entry(
    voice_id: str, display: str, category: str, language_label: str
) -> dict:
    return {
        "value": voice_id,
        "label": display,
        "category": category,
        "gender": derive_gender(voice_id),
        "language": derive_language(voice_id, language_label),
        "description": f"{display} — {language_label}",
    }


def build_voice_list() -> list[dict]:
    return [voice_entry(v_id, name, cat, lang) for (v_id, name, cat, lang) in VOICES]


def emit_sql(path: str, voices: list[dict]) -> None:
    """Produce a SQL file that UPDATEs the live `system_settings` row.

    Uses parameterised dollar-quoting so embedded quotes and unicode are safe.
    """
    body = json.dumps(voices, ensure_ascii=False)
    sql = (
        "-- Generated by migrate_voices_to_2_0.py — see file docstring.\n"
        "-- Idempotent: re-running just overwrites with the same payload.\n"
        "BEGIN;\n"
        "-- snapshot the pre-2.0 row for emergency restore (no-op on re-run).\n"
        "INSERT INTO system_settings_history (id, category, key, value, "
        "default_value, value_type, description, updated_at, updated_by)\n"
        "SELECT gen_random_uuid(), category, key, value, default_value, "
        "value_type, description, updated_at, "
        "'migrate_voices_to_2_0.py@2026-05-15'\n"
        "FROM system_settings WHERE category='tts' AND key='voices'\n"
        "ON CONFLICT DO NOTHING;\n\n"
        "UPDATE system_settings\n"
        f"SET value = $voices_json${body}$voices_json$::json,\n"
        f"    default_value = $voices_json${body}$voices_json$::json,\n"
        "    updated_at = NOW(),\n"
        "    updated_by = 'migrate_voices_to_2_0.py'\n"
        "WHERE category='tts' AND key='voices';\n"
        "COMMIT;\n"
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(sql)


def emit_json(path: str, voices: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(voices, f, ensure_ascii=False, indent=2)


def emit_yaml_block(path: str, voices: list[dict]) -> None:
    """Emit the YAML fragment to splice into `config/batch_tts_config.yaml`
    under `voice_types.volcano`. Replaces the existing `voices:` list — keep
    `name:` siblings untouched.
    """
    lines = ["    # Generated by scripts/migrate_voices_to_2_0.py — do not hand-edit.",
             "    voices:"]
    current_category = None
    for v in voices:
        if v["category"] != current_category:
            current_category = v["category"]
            lines.append(f"      # {current_category}")
        lines.append(f"      - value: '{v['value']}'")
        lines.append(f"        label: '{v['label']}'")
        lines.append(f"        category: '{v['category']}'")
        lines.append(f"        gender: '{v['gender']}'")
        lines.append(f"        language: '{v['language']}'")
        # YAML strings: single-quote with escaping for embedded single quotes
        desc = v['description'].replace("'", "''")
        lines.append(f"        description: '{desc}'")
        lines.append("")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def emit_python_fallback(path: str, voices: list[dict]) -> None:
    """Emit a Python literal mapping for `_get_fallback_voice_types`.

    Each entry: voice_id -> dict suitable to construct VoiceTypeInfo directly.
    """
    lines = [
        "# Generated by scripts/migrate_voices_to_2_0.py — do not hand-edit.",
        "FALLBACK_VOICES_2_0 = {",
    ]
    for v in voices:
        lines.append(
            f"    {v['value']!r}: dict(name={v['label']!r}, "
            f"language={v['language']!r}, gender={v['gender']!r}, "
            f"description={v['description']!r}, "
            f"category={v['category']!r}),"
        )
    lines.append("}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--sql", default="/tmp/update_voices.sql")
    p.add_argument("--json", default="/tmp/voices_2_0.json")
    p.add_argument("--py", default="/tmp/fallback_2_0.py")
    p.add_argument("--yaml", default="/tmp/voices_block.yaml")
    args = p.parse_args(argv)

    voices = build_voice_list()
    emit_sql(args.sql, voices)
    emit_json(args.json, voices)
    emit_python_fallback(args.py, voices)
    emit_yaml_block(args.yaml, voices)
    print(f"emitted {len(voices)} voices")
    print(f"  sql:  {args.sql}")
    print(f"  json: {args.json}")
    print(f"  py:   {args.py}")
    print(f"  yaml: {args.yaml}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
