const input = document.getElementById("idInput");
const aliasInput = document.getElementById("aliasInput"); // 없으면 null
const btn = document.getElementById("addBtn");
const list = document.getElementById("resultList");
const dateInfo = document.getElementById("dateInfo");

/* ───────────────── 유틸: storage Promise 래퍼 ───────────────── */
function getUsers() {
    return new Promise((resolve) => {
        chrome.storage.local.get({ users: [] }, ({ users }) => resolve(users));
    });
}
function setUsers(users) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ users }, resolve);
    });
}

/* ──────────────── 스키마 마이그레이션: ["jae"] -> [{handle,...}] ──────────────── */
async function migrateUsersIfNeeded() {
    const users = await getUsers();
    if (!users.length) return;
    if (typeof users[0] === "string") {
        const migrated = users.map((h) => ({
            handle: h,
            alias: "",
            reverseStreak: 0,
            lastSolvedDate: null,
            lastCheckedDate: null,
            todayCount: 0,
        }));
        await setUsers(migrated);
    }
}

/* ──────────────── 날짜 유틸 (solved.ac 06:00 경계) ──────────────── */
function getSolvedAcDate() {
    const now = new Date();
    if (now.getHours() < 6) now.setDate(now.getDate() - 1);
    return now.toLocaleDateString("en-CA"); // "YYYY-MM-DD"
}
function diffDays(a, b) {
    // a,b: "YYYY-MM-DD"
    const da = new Date(a),
        db = new Date(b);
    da.setHours(0, 0, 0, 0);
    db.setHours(0, 0, 0, 0);
    return Math.round((da - db) / (1000 * 60 * 60 * 24));
}

/* ──────────────── 상단 기준일 표시 ──────────────── */
function showDateInfo() {
    dateInfo.textContent = `기준일: ${getSolvedAcDate()}`;
}

function normalizeUsers(users) {
    // 문자열 배열이면 새 스키마로 변환
    if (users.length && typeof users[0] === "string") {
        return users.map((h) => ({
            handle: h,
            alias: "",
            reverseStreak: 0,
            lastSolvedDate: null,
            lastCheckedDate: null,
            todayCount: 0,
        }));
    }
    // todayCount 필드 보강
    return users.map((u) => ({ todayCount: 0, ...u }));
}

function displayNameOf(u) {
    return u.alias ? `${u.alias} (${u.handle})` : u.handle;
}

/* 정렬 규칙:
    1) reverseStreak===1 (단속대상) 우선, 그 안에서는 알파벳
    2) 나머지: todayCount 내림차순
    3) tie: reverseStreak 오름차순
    4) tie: 이름(별명→아이디) 알파벳
*/
function sortUsers(users) {
    users.sort((a, b) => {
        const aTodayOnly = a.reverseStreak === 1;
        const bTodayOnly = b.reverseStreak === 1;
        if (aTodayOnly !== bTodayOnly) return aTodayOnly ? -1 : 1;

        if (!aTodayOnly && !bTodayOnly) {
            const ac = a.todayCount || 0;
            const bc = b.todayCount || 0;
            if (ac !== bc) return bc - ac;
            if (a.reverseStreak !== b.reverseStreak)
                return a.reverseStreak - b.reverseStreak;
        }

        const aName = a.alias || a.handle;
        const bName = b.alias || b.handle;
        return aName.localeCompare(bName, "en", { sensitivity: "base" });
    });
}

function updateUI() {
    chrome.storage.local.get({ users: [] }, ({ users }) => {
        users = normalizeUsers(users);
        // 저장소에 반영(한 번만)
        chrome.storage.local.set({ users });

        sortUsers(users);

        list.innerHTML = "";
        users.forEach((u) => {
            const li = document.createElement("li");
            li.className = "user-item";

            // 왼쪽 텍스트
            const span = document.createElement("span");
            span.textContent = `${displayNameOf(u)}: 로딩중...`;
            li.appendChild(span);

            // 오른쪽 버튼 그룹 (✎, ×)
            const actions = document.createElement("div");

            // ✎ 별명 수정/추가/삭제(빈값)
            const edit = document.createElement("button");
            edit.textContent = "✎";
            edit.className = "edit-btn";
            edit.title = "별명 추가/수정";
            edit.onclick = () => {
                chrome.storage.local.get({ users: [] }, ({ users }) => {
                    const arr = normalizeUsers(users);
                    const me = arr.find((x) => x.handle === u.handle);
                    if (!me) return;
                    const next = (
                        prompt("별명 입력(비우면 삭제):", me.alias || "") || ""
                    ).trim();
                    me.alias = next; // 빈값이면 삭제 효과
                    chrome.storage.local.set({ users: arr }, updateUI);
                });
            };
            actions.appendChild(edit);

            // × 삭제
            const del = document.createElement("button");
            del.textContent = "×";
            del.className = "delete-btn";
            del.title = "삭제";
            del.onclick = () => {
                chrome.storage.local.get({ users: [] }, ({ users }) => {
                    const filtered = normalizeUsers(users).filter(
                        (x) => x.handle !== u.handle
                    );
                    chrome.storage.local.set({ users: filtered }, updateUI);
                });
            };
            actions.appendChild(del);

            li.appendChild(actions);
            list.appendChild(li);

            // 비동기: 오늘 데이터 → todayCount / reverseStreak 갱신 후 텍스트 업데이트
            chrome.runtime.sendMessage(
                { type: "FETCH_GRASS", handle: u.handle },
                (res) => {
                    if (!res || typeof res.count !== "number") {
                        span.textContent = `${displayNameOf(u)}: 에러`;
                        return;
                    }

                    const today = res.today || getSolvedAcDate();

                    chrome.storage.local.get({ users: [] }, ({ users }) => {
                        const arr = normalizeUsers(users);
                        const me = arr.find((x) => x.handle === u.handle);
                        if (!me) return;

                        me.todayCount = res.count;

                        if (res.count > 0) {
                            me.reverseStreak = 0;
                            me.lastSolvedDate = today;
                        } else {
                            // 오늘 0개면 background가 계산한 reverseStreak가 있으면 우선 사용
                            if (
                                typeof res.reverseStreak === "number" &&
                                res.reverseStreak >= 1
                            ) {
                                me.reverseStreak = res.reverseStreak;
                            } else {
                                // (백업) 마지막 체크일 기준 증가
                                if (
                                    me.lastCheckedDate &&
                                    me.lastCheckedDate !== today
                                ) {
                                    const delta = diffDays(
                                        today,
                                        me.lastCheckedDate
                                    );
                                    if (delta > 0) me.reverseStreak += delta;
                                } else if (!me.lastCheckedDate) {
                                    me.reverseStreak = Math.max(
                                        me.reverseStreak || 0,
                                        1
                                    );
                                }
                            }
                            // 더 최신의 lastSolvedDate가 오면 갱신
                            if (
                                res.lastSolvedDate &&
                                (!me.lastSolvedDate ||
                                    res.lastSolvedDate > me.lastSolvedDate)
                            ) {
                                me.lastSolvedDate = res.lastSolvedDate;
                            }
                        }

                        me.lastCheckedDate = today;

                        chrome.storage.local.set({ users: arr }, () => {
                            console.log("[POPUP] show", u.handle, {
                                count: res.count,
                                rs: me.reverseStreak,
                                lastSolvedDate: me.lastSolvedDate,
                            });
                            
                            // 표시 규칙: 0개일 때 reverseStreak===1 → 단속대상!!!, ≥2 → 리버스스트릭 N일째
                            const label = displayNameOf(me);
                            let rightText;
                            if (res.count > 0) {
                                rightText = `${res.count}문제`;
                            } else {
                                rightText =
                                    me.reverseStreak >= 2
                                        ? `리버스스트릭 ${me.reverseStreak}일째`
                                        : `단속대상!!!`;
                            }
                            span.textContent = `${label}: ${rightText}`;
                        });
                    });
                }
            );
        });
    });
}

/* ──────────────── 사용자 추가 (별명 포함, 없으면 공백) ──────────────── */
btn.onclick = () => {
    const handle = input.value.trim();
    const alias = aliasInput ? aliasInput.value.trim() : "";
    if (!handle) {
        return;
    }

    input.value = "";
    if (aliasInput) {
        aliasInput.value = "";
    }

    chrome.storage.local.get({ users: [] }, ({ users }) => {
        users = normalizeUsers(users);
        if (users.some((u) => u.handle === handle)) {
            updateUI();
            return;
        }

        // 등록 직후 solved.ac 조회 → 초기값 계산
        chrome.runtime.sendMessage({ type: "FETCH_GRASS", handle }, (res) => {
            const today = res?.today || getSolvedAcDate();

            let reverseStreak = 0;
            let lastSolvedDate = res.lastSolvedDate || null;

            if (res.count === 0) {
                if (
                    typeof res.reverseStreak === "number" &&
                    res.reverseStreak >= 1
                ) {
                    reverseStreak = res.reverseStreak; // background 계산 사용
                } else if (lastSolvedDate) {
                    reverseStreak = Math.max(
                        1,
                        diffDays(today, lastSolvedDate)
                    );
                } else {
                    reverseStreak = 1; // 한 번도 안 풀었고 오늘도 0
                }
            }

            users.push({
                handle,
                alias,
                reverseStreak,
                lastSolvedDate, // null일 수도 있음
                lastCheckedDate: today,
                todayCount: res.count || 0,
            });

            chrome.storage.local.set({ users }, updateUI);
        });
    });
};

function removeUser(handle) {
    chrome.storage.local.get({ users: [] }, ({ users }) => {
        const filtered = normalizeUsers(users).filter(
            (u) => u.handle !== handle
        );
        chrome.storage.local.set({ users: filtered }, updateUI);
    });
}

/* ──────────────── 초기 부트스트랩 ──────────────── */
document.addEventListener("DOMContentLoaded", async () => {
    await migrateUsersIfNeeded();
    showDateInfo();
    updateUI();
});
