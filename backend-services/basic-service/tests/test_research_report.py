"""来源取得方式、引用与输出去敏的纯函数契约。"""
import copy
import json

import pytest


def source(identifier="a"):
    return {
        "id": identifier,
        "url": "https://user:pw@example.com/p?token=SECRET&ok=1#SECRET",
        "title": "来源",
        "domain": "example.com",
        "extra": "private",
    }


def usage(status="disabled"):
    stage = {
        "status": status,
        "attempts": 0 if status == "disabled" else 1,
        "model_name": None if status == "disabled" else "模型",
        "error_code": None,
        "reason": None,
    }
    return {"query": stage.copy(), "synthesis": stage.copy()}


def report(ids=None):
    return {
        "brief": "报告",
        "facts": [{"text": "事实", "source_ids": ids or ["a"]}],
        "uncertainties": [],
    }


def test_normalization_fallback_and_immutable_source():
    from app.services.web_research.research_report import normalize_source

    original = source()
    before = copy.deepcopy(original)
    evidence = normalize_source(
        original, {"text": "\x00  ", "title": "错误标题"}, " 搜索摘要 "
    )
    assert evidence.kind == "search_snippet" and evidence.text == "搜索摘要"
    assert evidence.fetch_error_code == "empty_source"
    assert evidence.source["title"] == "来源"
    assert (
        original == before
        and evidence.source["url"] == "https://example.com/p?ok=1"
    )
    assert "extra" not in evidence.source


@pytest.mark.parametrize(
    "kinds,quality",
    [
        ([], "none"),
        (["unavailable"], "none"),
        (["page_text"], "full_text"),
        (["search_snippet"], "snippets_only"),
        (["page_text", "unavailable"], "mixed"),
        (["page_text", "search_snippet"], "mixed"),
    ],
)
def test_coverage(kinds, quality):
    from app.services.web_research.research_report import (
        SourceEvidence,
        summarize_coverage,
    )

    evidence = [
        SourceEvidence(
            source(str(i)), kind, "" if kind == "unavailable" else "x"
        )
        for i, kind in enumerate(kinds)
    ]
    actual, counts = summarize_coverage(evidence)
    assert actual == quality and counts["selected"] == len(kinds)
    assert counts["selected"] == sum(
        counts[k] for k in ("page_text", "search_snippet", "unavailable")
    )


@pytest.mark.parametrize(
    "bad",
    [
        {"brief": " ", "facts": [], "uncertainties": []},
        {"brief": "x", "facts": [], "uncertainties": []},
        {**report(), "quality": "full_text"},
        report(["a", "a"]),
        report(["missing"]),
        report([{}]),
        report([""]),
        {
            **report(),
            "facts": [
                {"text": "x", "source_ids": ["a"], "evidence_kind": "page_text"}
            ],
        },
        '{"brief":"x","brief":"y","facts":[],"uncertainties":[]}',
        '{"brief":"x","facts":[],"uncertainties":[NaN]}',
        {"brief": "\ud800", "facts": [], "uncertainties": []},
    ],
)
def test_reject_invalid_reports(bad):
    from app.services.web_research.research_report import validate_report

    with pytest.raises(ValueError):
        validate_report(bad, {"a"})


def test_text_urls_clean_before_clipping_and_validation():
    from app.services.web_research.research_report import (
        sanitize_text,
        normalize_source,
        validate_report,
    )

    text = "中文[链接](https://u:PASS@a.test/p?x-amz-signature=SECRET&ok=1#SECRET)，https://b.test/?x-goog-key=SECRET。结束"
    clean = sanitize_text(text)
    assert "SECRET" not in clean and "PASS" not in clean
    assert "https://a.test/p?ok=1" in clean and "。结束" in clean
    assert (
        sanitize_text("链接 https://a.test:wrong/?token=SECRET 结束")
        == "链接 链接已隐藏 结束"
    )
    evidence = normalize_source(
        source(),
        {"text": text * 300, "title": text, "final_url": source()["url"]},
        "",
    )
    assert (
        len(evidence.text.encode()) <= 12000 and "SECRET" not in evidence.text
    )
    assert "SECRET" not in json.dumps(evidence.source)
    parsed = validate_report(
        {
            "brief": text,
            "facts": [{"text": text, "source_ids": ["a"]}],
            "uncertainties": [text],
        },
        {"a"},
    )
    assert "SECRET" not in json.dumps(parsed)


@pytest.mark.parametrize(
    "raw,expected",
    [
        (
            "https://[2001:4860:4860::8888]/doc?token=TEST_SECRET",
            "https://[2001:4860:4860::8888]/doc",
        ),
        (
            "[resource](https://example.com/doc?token=abc(def)ghi)",
            "[resource](https://example.com/doc)",
        ),
        ("https://alice:p(a)ss@example.com/doc", "https://example.com/doc"),
        (
            "(https://alice:p(a)ss@example.com/doc?token=abc(def)ghi)",
            "(https://example.com/doc)",
        ),
        (
            "[链接](https://example.com/doc?q=useful(value)&sig=abc(def)ghi)。",
            "[链接](https://example.com/doc?q=useful%28value%29)。",
        ),
    ],
)
def test_complete_url_capture_cleans_ipv6_and_parenthesized_credentials(
    raw, expected
):
    from app.services.web_research.research_report import sanitize_text

    assert sanitize_text(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("https://alice:p'ass@example.com/doc", "https://example.com/doc"),
        ("https://example.com/doc?token=abc'def", "https://example.com/doc"),
        (
            "'https://alice:p'ass@example.com/doc?token=abc'def'",
            "'https://example.com/doc'",
        ),
    ],
)
def test_single_quotes_inside_url_are_not_secret_boundaries(raw, expected):
    from app.services.web_research.research_report import sanitize_text

    assert sanitize_text(raw) == expected


def test_finalize_derives_facts_limits_and_degradation():
    from app.services.web_research.research_report import (
        normalize_source,
        finalize_report,
    )

    evidence = [
        normalize_source(source("a"), {"text": "正文"}, ""),
        normalize_source(source("b"), None, "摘要", "robots_disallowed"),
        normalize_source(source("c"), None, "", "upstream_timeout"),
    ]
    result = finalize_report(
        {
            "evidence": evidence,
            "report": report(["a", "b"]),
            "model_usage": usage("succeeded"),
        }
    )
    assert (
        result["quality"] == "mixed" and result["degraded"] == "partial_sources"
    )
    assert result["facts"][0]["evidence_kind"] == "includes_snippet"
    assert result["uncertainties"][:2] == [
        "来源[2]未取得原文，仅使用搜索摘要。",
        "来源[3]未取得可引用内容。",
    ]
    assert result["model_used"] == "模型"
    fallback = finalize_report(
        {"evidence": evidence, "report": None, "model_usage": usage()}
    )
    assert [f["source_ids"] for f in fallback["facts"]] == [["a"], ["b"]]
    assert (
        fallback["degraded"] == "excerpts_only"
        and fallback["model_used"] is None
    )


@pytest.mark.parametrize("mixed", [False, True])
def test_full_model_limitations_keep_mandatory_verification_notice(mixed):
    from app.services.web_research.research_report import (
        GENERIC_LIMITATION, SECOND_SEARCH_LIMITATION,
        finalize_report, normalize_source,
    )

    evidence = [normalize_source(source("a"), {"text": "正文"})]
    if mixed:
        evidence.append(normalize_source(source("b"), snippet="摘要"))
    model_report = report()
    model_report["uncertainties"] = [f"模型限制{i}" for i in range(10)]
    result = finalize_report({
        "evidence": evidence,
        "report": model_report,
        "model_usage": usage("succeeded"),
        "second_search_failed": mixed,
    })

    notes = result["uncertainties"]
    assert len(notes) == 10
    assert notes[-1] == GENERIC_LIMITATION
    assert len(set(notes)) == len(notes)
    if mixed:
        assert notes[:2] == [
            "来源[2]未取得原文，仅使用搜索摘要。", SECOND_SEARCH_LIMITATION,
        ]
    assert model_report["uncertainties"] == [f"模型限制{i}" for i in range(10)]


def test_artifact_v2_roundtrip_and_limit():
    from app.services.web_research.research_report import (
        normalize_source,
        finalize_report,
        serialize_report,
    )
    from app.models.web_research_models import WebResearchError

    evidence = [
        normalize_source(source(str(i)), {"text": '\\"\n\t' * 3000}, "")
        for i in range(5)
    ]
    result = finalize_report(
        {"evidence": evidence, "report": None, "model_usage": usage()}
    )
    raw = serialize_report(result, evidence)
    decoded = json.loads(raw)
    assert len(raw) <= 393216 and decoded["schema_version"] == 2
    assert len(decoded["evidence"]) == 5 and "evidence" not in result
    with pytest.raises(WebResearchError, match="response_too_large"):
        serialize_report({**result, "brief": "x" * 393216}, evidence)


def test_output_models_validate_cross_fields_and_keep_legacy():
    from app.models.web_research_models import (
        WebResearchData,
        ResearchCoverage,
        ResearchModelStage,
    )

    assert WebResearchData(brief="旧报告").quality is None
    with pytest.raises(ValueError):
        ResearchCoverage(
            selected=2, page_text=1, search_snippet=0, unavailable=0
        )
    with pytest.raises(ValueError):
        ResearchModelStage(status="succeeded", attempts=0)
    with pytest.raises(ValueError):
        ResearchModelStage(status="skipped", attempts=1, reason="no_sources")


@pytest.mark.parametrize(
    "page_count,snippet_count,query_state,synthesis_state,expected",
    [
        (0, 0, "disabled", "disabled", "sources_unavailable"),
        (0, 1, "failed", "skipped", "sources_unavailable"),
        (1, 0, "failed", "skipped", "research_model_unavailable"),
        (1, 0, "succeeded", "failed", "excerpts_only"),
        (1, 0, "succeeded", "succeeded", None),
        (1, 1, "succeeded", "succeeded", "partial_sources"),
    ],
)
def test_degraded_priority(
    page_count, snippet_count, query_state, synthesis_state, expected
):
    from app.services.web_research.research_report import (
        normalize_source,
        finalize_report,
    )

    stages = usage()
    for stage, status in [
        ("query", query_state),
        ("synthesis", synthesis_state),
    ]:
        stages[stage] = {
            "status": status,
            "attempts": int(status in {"failed", "succeeded"}),
            "model_name": "模型" if status in {"failed", "succeeded"} else None,
            "reason": "prior_stage_failed" if status == "skipped" else None,
            "error_code": "research_model_timeout"
            if status == "failed"
            else None,
        }
    evidence = []
    if page_count:
        evidence.append(normalize_source(source("a"), {"text": "正文"}, ""))
    if snippet_count:
        evidence.append(normalize_source(source("b"), None, "摘要"))
    if not evidence:
        evidence.append(normalize_source(source("c"), None, ""))
    result = finalize_report(
        {
            "evidence": evidence,
            "report": report() if synthesis_state == "succeeded" else None,
            "model_usage": stages,
            "degraded": "model_cannot_override",
        }
    )
    assert result["degraded"] == expected


def test_no_sources_and_unavailable_never_produce_facts():
    from app.services.web_research.research_report import (
        normalize_source,
        finalize_report,
    )

    for evidence, degraded in [
        ([], "no_sources"),
        ([normalize_source(source(), None, "")], "sources_unavailable"),
    ]:
        result = finalize_report({"evidence": evidence, "model_usage": usage()})
        assert result["facts"] == [] and result["quality"] == "none"
        assert result["degraded"] == degraded


def test_all_sources_fields_bounded_and_unknown_errors_hidden():
    from app.services.web_research.research_report import normalize_source

    incoming = {
        **source(),
        "title": "中" * 1000,
        "author": "中" * 1000,
        "domain": "x" * 1000,
        "retrieved_at": "x" * 1000,
        "published_at": "x" * 1000,
        "url": "https://example.com/" + "x" * 4096,
        "final_url": "javascript:secret",
        "license_url": "https://x:invalid/?token=PRIVATE",
        "license_status": "invented",
    }
    result = normalize_source(
        incoming, None, "中" * 1000, "exception PRIVATE"
    ).source
    assert (
        result["url"] == ""
        and result["final_url"] is None
        and result["license_url"] is None
    )
    assert (
        result["license_status"] == "unknown"
        and result["fetch_error_code"] == "source_unavailable"
    )
    for key, maximum in [
        ("title", 512),
        ("author", 512),
        ("domain", 256),
        ("retrieved_at", 64),
        ("published_at", 64),
    ]:
        assert len(result[key].encode()) <= maximum


def test_worst_case_artifact_escape_roundtrip():
    from app.services.web_research.research_report import (
        normalize_source,
        finalize_report,
        serialize_report,
    )

    escaped = '\\"\n\t'
    evidence = []
    for index in range(5):
        metadata = {
            **source(str(index)),
            "title": escaped * 128,
            "author": escaped * 128,
            "domain": escaped * 64,
            "retrieved_at": escaped * 16,
            "published_at": escaped * 16,
            "license_url": "https://x.test/" + "a" * 4000,
        }
        evidence.append(
            normalize_source(metadata, {"text": escaped * 3000}, "")
        )
    draft = {
        "brief": escaped * 1500,
        "facts": [
            {"text": escaped * 250, "source_ids": [str(i) for i in range(5)]}
            for _ in range(20)
        ],
        "uncertainties": [str(i) + escaped * 127 for i in range(10)],
    }
    result = finalize_report(
        {
            "evidence": evidence,
            "report": draft,
            "model_usage": usage("succeeded"),
        }
    )
    raw = serialize_report(result, evidence)
    assert len(raw) < 393216 and json.loads(raw)["facts"] == result["facts"]


@pytest.mark.parametrize(
    "mutation", ["coverage", "quality", "citation", "model", "kind"]
)
def test_typed_report_rejects_inconsistent_server_metadata(mutation):
    from app.services.web_research.research_report import (
        normalize_source,
        finalize_report,
    )
    from app.models.web_research_models import WebResearchData

    result = finalize_report(
        {
            "evidence": [normalize_source(source(), {"text": "正文"}, "")],
            "model_usage": usage(),
        }
    )
    if mutation == "coverage":
        result["coverage"]["selected"] = 0
    elif mutation == "quality":
        result["quality"] = "snippets_only"
    elif mutation == "citation":
        result["facts"][0]["source_ids"] = ["unknown"]
    elif mutation == "model":
        result["model_used"] = "fake"
    else:
        result["facts"][0]["evidence_kind"] = "includes_snippet"
    with pytest.raises(ValueError):
        WebResearchData(**result)
