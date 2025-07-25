const input = document.getElementById("idInput");
const btn = document.getElementById("addBtn");
const list = document.getElementById("resultList");
const dateInfo = document.getElementById("dateInfo");

// 로컬 기준 YYYY-MM-DD 생성 함수
function getLocalDate() {
    return new Date().toLocaleDateString("en-CA");  // YYYY-MM-DD
}

// UI 업데이트 전에 기준 날짜 먼저 표시
function showDateInfo() {
    dateInfo.textContent = `기준일: ${getSolvedAcDate()}`;
}

function getSolvedAcDate() {
    const now = new Date();
    if (now.getHours() < 6) now.setDate(now.getDate() - 1);
    return now.toLocaleDateString("en-CA");
}

function updateUI(users) {
    list.innerHTML = "";
    users.forEach(handle => {
        chrome.runtime.sendMessage({ type: "FETCH_GRASS", handle }, res => {
            const li = document.createElement("li");
            if (res.count > 0) {
                li.textContent = `${handle}: ${res.count}문제`;
            } else if (res.count == 0) {
                li.textContent = `${handle}: 단속대상!!!`
            } else {
                li.textContent = `${handle}: 에러`;
            }
            list.appendChild(li);
        });
    });
}

btn.onclick = () => {
    const id = input.value.trim();
    if (!id) return;

    chrome.storage.local.get({ users: [] }, ({ users }) => {
        if (!users.includes(id)) {
            const newUsers = [...users, id];
            chrome.storage.local.set({ users: newUsers }, () => updateUI(newUsers));
        }
    });
};

// 팝업 열릴 때 날짜 표시 + 사용자 리스트 로드
document.addEventListener("DOMContentLoaded", () => {
    showDateInfo();
    chrome.storage.local.get({ users: [] }, ({ users }) => updateUI(users));
});