/**
 * The page Kart Circuit is shown in: its own index.html, with its stylesheet and
 * script paths pointed at public/kart-circuit/ and the hub-only bits (shared
 * graphics/keyboard scripts) dropped. It's loaded into the frame with `srcdoc`,
 * which - unlike pointing the frame at a separate file - keeps it the same
 * origin as the arcade, so it can be allowed the gamepad and fullscreen even in
 * the desktop app (where every file:// page is its own origin).
 */
export const KART_FRAME_HTML = `<!doctype html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0" />
    <meta http-equiv="Pragma" content="no-cache" />
    <meta http-equiv="Expires" content="0" />
    <title>Kart Circuit</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Oswald:wght@400;500;700&display=swap"
        rel="stylesheet" />
    <link rel="stylesheet" href="kart-circuit/styles.css?v=20260828a" />
    <!-- classic-kart-racer-style front end, layered over styles.css — see its header. -->
    <link rel="stylesheet" href="kart-circuit/mk8-menu.css?v=20260828c" />
    <link rel="stylesheet" href="kart-circuit/embed.css" />
</head>

<body>
    <main class="shell shell--embedded">
        <section class="game-frame">
            <canvas id="game" width="960" height="640" aria-label="Kart circuit game"></canvas>
            <div class="touch-controls" aria-label="Touch controls">
                <div class="touch-dpad">
                    <button class="touch-button" data-key="ArrowLeft" data-label="Left" type="button">Left</button>
                    <button class="touch-button touch-button--primary" data-key="ArrowUp" data-label="Drive"
                        type="button">Drive</button>
                    <button class="touch-button" data-key="ArrowRight" data-label="Right" type="button">Right</button>
                </div>
                <div class="touch-actions">
                    <button class="touch-button touch-button--accent" data-key="Space" data-label="Item"
                        type="button">Item</button>
                    <button class="touch-button" data-key="ArrowDown" data-label="Brake" type="button">Brake</button>
                </div>
            </div>
            <div class="dev-cheat-panel hidden" id="devCheatPanel">
                <p class="dev-cheat-title">🛠️ Dev Cheats</p>
                <button id="devFlyButton" class="mode-button" type="button">Fly: Off</button>
                <button id="devGodModeButton" class="mode-button" type="button">God Mode: Off</button>
                <button id="devInfiniteItemsButton" class="mode-button" type="button">Infinite Items: Off</button>
                <div class="dev-cheat-speed-row">
                    <select id="devItemChoice" title="Which item Infinite Items keeps you holding"></select>
                </div>
                <div class="dev-cheat-speed-row">
                    <select id="devSpeedTarget" title="Who Speed applies to"></select>
                </div>
                <div class="dev-cheat-speed-row">
                    <label for="devSpeedInput">Speed</label>
                    <input id="devSpeedInput" type="number" step="10" placeholder="auto" />
                    <button id="devSpeedSetButton" class="mode-button" type="button">Set</button>
                    <button id="devSpeedClearButton" class="mode-button" type="button">Clear</button>
                </div>
            </div>
            <div class="overlay" id="overlay">
              <!-- One decision per screen, classic kart racers style, instead of the single
              scrolling card this used to be. Every control below is the *same
              element* it always was — same ids, same classes — just re-parented
              into a step; game.js's wiring is untouched by this. The flow itself
              (which steps a mode visits, what's skipped) lives in menu-flow.js. -->
              <div class="overlay-card mk-wizard">
                <header class="mk-wizard-head">
                  <p class="overlay-kicker">Kart Circuit</p>
                  <h2 id="mkStepTitle">Take the lead</h2>
                  <p id="overlayDescription" class="mk-step-hint">
                    Hold your line, hit the boosts, and manage speed through the
                    corners. Cross the finish gate after every checkpoint to score a lap.
                  </p>
                  <ol class="mk-step-dots" id="mkStepDots" aria-label="Setup progress"></ol>
                </header>

                <div id="p1PromptBanner" class="p1-prompt hidden" aria-label="Choose Player 1 controller">
                  <p class="p1-prompt-title">Multiple controllers connected — who's Player 1?</p>
                  <div id="p1PromptList" class="p1-prompt-list"></div>
                  <button id="p1PromptDismiss" class="mode-button" type="button">Decide later</button>
                </div>

                <div class="mk-stage" id="mkStage">
                  <section class="mk-step" data-step="mode" data-title="Choose a mode" data-hint="How do you want to race?">
                    <div class="mk-mode-grid">
                      <button class="mk-mode-card" data-mode="solo" type="button">
                        <span class="mk-mode-icon">🏎️</span>
                        <span class="mk-mode-name">Single Player</span>
                        <span class="mk-mode-desc">Race the field on your own</span>
                      </button>
                      <button class="mk-mode-card" data-mode="local" type="button">
                        <span class="mk-mode-icon">👫</span>
                        <span class="mk-mode-name">Local Multiplayer</span>
                        <span class="mk-mode-desc">2-4 on this screen</span>
                      </button>
                      <button class="mk-mode-card" data-mode="online" type="button">
                        <span class="mk-mode-icon">🌍</span>
                        <span class="mk-mode-name">Play Online</span>
                        <span class="mk-mode-desc">Regional or worldwide, matched at random</span>
                      </button>
                      <button class="mk-mode-card" data-mode="friends" type="button">
                        <span class="mk-mode-icon">📡</span>
                        <span class="mk-mode-name">Play with Friends</span>
                        <span class="mk-mode-desc">Share a room code</span>
                      </button>
                    </div>
                    <button id="mkControlsButton" class="mode-button mk-secondary" type="button">🎮 Controls &amp; gamepad</button>
                  </section>

                  <section class="mk-step" data-step="players" data-title="How many players?" data-hint="Each seat gets its own half of the screen and its own keys.">
                    <div class="local-mp-panel" aria-label="Local multiplayer (same PC)">
                      <p class="mp-kicker">Local multiplayer · same PC, shared keyboard</p>
                      <div class="local-mp-picker" id="localPlayerPicker">
                        <button class="local-mp-button is-selected" data-local-players="1" type="button">1 Player</button>
                        <button class="local-mp-button" data-local-players="2" type="button">2 Players</button>
                        <button class="local-mp-button" data-local-players="3" type="button">3 Players</button>
                        <button class="local-mp-button" data-local-players="4" type="button">4 Players</button>
                      </div>
                      <p id="localPlayerHint" class="local-mp-hint">P1: Arrow Keys + Space</p>
                      <p class="local-mp-hint">Split-screen seats P1-P4 use whoever's signed in under 👤 Profile → Local players on the hub, in order.</p>
                      <div class="local-roster-solo" id="localRosterSoloRow">
                        <label class="local-mp-hint" for="localSoloSelect" style="margin:0">Playing as:</label>
                        <select id="localSoloSelect"></select>
                      </div>
                    </div>
                  </section>

                  <section class="mk-step" data-step="online" data-title="Play online" data-hint="Pick a pool and you'll be matched with whoever else is searching.">
                    <div class="mk-pool-grid" id="onlinePoolPicker">
                      <button class="mk-pool-card" data-pool="regional" type="button">
                        <span class="mk-pool-icon">📍</span>
                        <span class="mk-mode-name">Regional</span>
                        <span class="mk-mode-desc">Racers near you — the smoothest connection</span>
                      </button>
                      <button class="mk-pool-card" data-pool="global" type="button">
                        <span class="mk-pool-icon">🌐</span>
                        <span class="mk-mode-name">Global</span>
                        <span class="mk-mode-desc">Anyone, anywhere in the world</span>
                      </button>
                    </div>
                    <div class="mk-lobby">
                      <p class="mp-kicker">Lobby</p>
                      <p id="onlineStatus" class="mk-lobby-status">Pick a pool to start searching.</p>
                      <p id="onlineRacerList" class="mk-lobby-racers"></p>
                      <p class="local-mp-hint">The track is picked at random and the race starts on its own once enough racers are in.</p>
                      <button id="onlineLeaveButton" class="mode-button" type="button">🚪 Leave the lobby</button>
                    </div>
                    <!-- While a lobby step is on screen, menu-flow.js parks the chat
                         panel and the camera strip in here. They normally float over
                         the track (which is right during a race, and a mess on top of
                         a menu) — moving the live nodes keeps every handler and every
                         playing video stream intact. -->
                    <div class="mk-lobby-dock" data-lobby-dock></div>
                  </section>

                  <section class="mk-step" data-step="friends" data-title="Play with friends" data-hint="Host a room and share the code, or enter one you were given.">
                    <div class="mp-panel" aria-label="Wireless multiplayer">
                      <p class="mp-kicker">Wireless multiplayer · up to 13 racers</p>
                      <p id="mpStatus" class="mp-status">Race solo, or connect with friends on your network.</p>
                      <div class="mp-controls">
                        <input id="mpNameInput" type="text" placeholder="Your name" maxlength="14" />
                        <button id="mpHostButton" type="button">Host Race</button>
                        <input id="mpJoinCodeInput" type="text" placeholder="Code" maxlength="4" />
                        <button id="mpJoinButton" type="button">Join Race</button>
                      </div>
                      <button id="mpMediaTestButton" class="mode-button" type="button">🧪 Test Cam &amp; Mic</button>
                      <div id="mpRoomInfo" class="mp-room-info hidden">
                        <p>Room code: <strong id="mpRoomCode"></strong> — share this with friends on your network.</p>
                        <p id="mpPlayerList" class="mp-player-list"></p>
                        <button id="mpVoiceButton" class="mode-button" type="button">🎤 Voice Chat: Off</button>
                        <button id="mpVideoButton" class="mode-button" type="button">📷 Video Chat: Off</button>
                        <button id="mpLeaveButton" class="mode-button" type="button">🚪 Leave Room</button>
                      </div>
                    </div>
                    <div class="mk-lobby-dock" data-lobby-dock></div>
                  </section>

                  <section class="mk-step" data-step="driver" data-title="Driver &amp; kart" data-hint="Pick who you're racing as and what you're racing in.">
                    <div class="driver-panel" aria-label="Character and kart selection">
                      <p class="mp-kicker">Driver &amp; Kart</p>
                      <div id="characterPicker" class="map-picker"></div>
                      <div id="kartPicker" class="map-picker"></div>
                      <div id="kartColorPicker" class="map-picker"></div>
                      <p id="driverHint" class="local-mp-hint"></p>
                    </div>
                  </section>

                  <section class="mk-step" data-step="cup" data-title="Choose a cup" data-hint="A cup runs its tracks in order for points. Free Play lets you pick one track.">
                    <div class="cup-picker" aria-label="Cup selection">
                      <button class="cup-button is-selected" data-cup="free" data-color="#ffd166" type="button">
                        <span class="map-preview"></span>Free Play
                      </button>
                      <button class="cup-button" data-cup="neon" data-color="#53e0ff" type="button">
                        <span class="map-preview"></span>Neon Cup
                      </button>
                      <button class="cup-button" data-cup="skyline" data-color="#ff9f6e" type="button">
                        <span class="map-preview"></span>Skyline Cup
                      </button>
                      <button class="cup-button" data-cup="grandprix" data-color="#ffd166" type="button">
                        <span class="map-preview"></span>Grand Prix
                      </button>
                      <button class="cup-button" data-cup="world" data-color="#a06bff" type="button">
                        <span class="map-preview"></span>🌍 World Tour
                      </button>
                    </div>
                  </section>

                  <section class="mk-step" data-step="track" data-title="Choose a track" data-hint="Free Play only — a cup brings its own tracks.">
                    <div class="map-picker" aria-label="Map selection">
                      <button class="map-button is-selected" data-map="neon" data-color="#53e0ff" type="button">
                        <span class="map-preview"></span>Neon Loop
                      </button>
                      <button class="map-button" data-map="harbor" data-color="#4e9fd6" type="button">
                        <span class="map-preview"></span>Harbor Bend
                      </button>
                      <button class="map-button" data-map="canyon" data-color="#d9754d" type="button">
                        <span class="map-preview"></span>Canyon Run
                      </button>
                      <button class="map-button" data-map="metro" data-color="#ff9f6e" type="button">
                        <span class="map-preview"></span>Metro Surge
                      </button>
                      <button class="map-button" data-map="summit" data-color="#9bc7ff" type="button">
                        <span class="map-preview"></span>Summit Spiral
                      </button>
                      <button class="map-button" data-map="boardwalk" data-color="#49c0a8" type="button">
                        <span class="map-preview"></span>Boardwalk Dash
                      </button>
                      <button class="map-button" data-map="grove" data-color="#8dd66e" type="button">
                        <span class="map-preview"></span>Grove Circuit
                      </button>
                      <button class="map-button" data-map="foundry" data-color="#ff7d5a" type="button">
                        <span class="map-preview"></span>Foundry Drift
                      </button>
                      <button class="map-button" data-map="skyway" data-color="#a06bff" type="button">
                        <span class="map-preview"></span>🌍 Rainbow Skyway
                      </button>
                      <button class="map-button" data-map="savanna" data-color="#ffb75e" type="button">
                        <span class="map-preview"></span>🌍 Great Savanna
                      </button>
                      <button class="map-button" data-map="volcano" data-color="#ff5d3a" type="button">
                        <span class="map-preview"></span>🌍 Volcano Rim
                      </button>
                      <button class="map-button" data-map="fjord" data-color="#9be4ff" type="button">
                        <span class="map-preview"></span>🌍 Frost Fjord
                      </button>
                      <button class="map-button" data-map="cloud" data-color="#ffe9a8" type="button">
                        <span class="map-preview"></span>🌍 Cloud Canyon
                      </button>
                      <button class="map-button" data-map="turbo" data-color="#ff4fa3" type="button">
                        <span class="map-preview"></span>🌍 Turbo City
                      </button>
                    </div>
                  </section>

                  <section class="mk-step" data-step="difficulty" data-title="Difficulty" data-hint="How hard the field races you.">
                    <div class="difficulty-picker" aria-label="Difficulty selection">
                      <button class="difficulty-button" data-difficulty="easy" type="button">Easy</button>
                      <button class="difficulty-button is-selected" data-difficulty="medium"
                      type="button">Medium</button>
                      <button class="difficulty-button" data-difficulty="hard" type="button">Hard</button>
                    </div>
                  </section>

                  <section class="mk-step" data-step="controls" data-title="Controls" data-hint="Connected pads and what every button does. You can also see this any time by pausing mid-race.">
                    <div class="gamepad-panel" aria-label="Gamepad mapping">
                      <p class="mp-kicker">Gamepad · Switch 2 layout · one pad per player</p>
                      <p id="gamepadStatusLine" class="local-mp-hint">No gamepads detected — press any button on your controller.</p>
                      <div id="gamepadPadList" class="gamepad-pad-list"></div>
                      <div id="gamepadMapList" class="gamepad-map-list"></div>
                      <div id="gamepadCursorPrefs" class="gamepad-cursor-prefs"></div>
                      <button id="gamepadResetButton" class="mode-button" type="button">Reset Mapping</button>
                    </div>
                  </section>

                  <section class="mk-step" data-step="ready" data-title="Ready to race" data-hint="Everything's set. Check it over, then drop the flag.">
                    <div id="mkSummary" class="mk-summary"></div>
                    <div id="cupSummary" class="cup-summary">Free Play: pick any track or choose a cup.</div>
                  </section>
                </div>

                <footer class="mk-wizard-nav">
                  <button id="mkBackButton" class="mk-nav-button" type="button">‹ Back</button>
                  <span id="mkStepCount" class="mk-step-count"></span>
                  <!-- Start Race lives in the footer, not inside the ready step: the
                       step area scrolls, and the one button the whole flow leads to
                       must never be the thing that's below the fold. -->
                  <button id="startButton" type="button">Start Race</button>
                  <button id="mkNextButton" class="mk-nav-button mk-nav-next" type="button">Next ›</button>
                </footer>
              </div>
            </div>
            <div id="mpChat" class="mp-chat hidden">
                <div id="mpChatLog" class="mp-chat-log" aria-live="polite"></div>
                <form id="mpChatForm" class="mp-chat-form" autocomplete="off">
                    <input id="mpChatInput" type="text" placeholder="Message… (Enter to send)" maxlength="140" autocomplete="off" />
                    <button type="submit">Send</button>
                </form>
            </div>
            <div id="mpVideos" class="mp-videos hidden"></div>
        </section>

        <section class="footer-bar">
            <div id="statusText">Ready on the grid.</div>
            <div id="raceInfo">Lap 1 / 5</div>
            <div id="difficultyStatus" class="difficulty-status">Difficulty: Medium</div>
            <div id="cupStatus" class="difficulty-status">Cup: Free Play</div>
            <div id="mapStatus" class="difficulty-status">Map: Neon Loop</div>
            <button id="mapButton" class="mode-button" type="button">Map: Neon Loop</button>
            <button id="autoSteerButton" class="mode-button" type="button">Auto Steer: Off</button>
            <button id="miniMapButton" class="mode-button" type="button">Mini Map: On</button>
            <button id="devModeButton" class="mode-button" type="button">Dev Mode: Off</button>
            <button id="themeButton" class="mode-button" type="button">Theme: Day</button>
            <button id="modeButton" class="mode-button" type="button">Mode: 3D</button>
            <button id="camButton" class="mode-button" type="button">Cam: Chase</button>
            <button id="hdrButton" class="mode-button" type="button">HDR: On</button>
            <button id="audioButton" class="mode-button" type="button">Audio: On</button>
            <button id="fullScreenButton" class="mode-button" type="button">Full: Off</button>
            <button id="vrButton" class="mode-button" type="button" hidden>Enter VR</button>
            <button id="pauseButton" class="mode-button" type="button">Pause: Off</button>
        </section>
    </main>

    <script src="kart-circuit/three.min.js?v=20260815a-vendor"></script>
    <script src="kart-circuit/game.js?v=20260902a"></script>
    <script src="kart-circuit/menu-flow.js?v=20260828b"></script>
    <!-- (arcade) forwards Escape so it can take you back to the menu -->
    <script src="kart-circuit/bridge.js"></script>
</body>

</html>`;
