from typing import Any, Text, Dict, List
from rasa_sdk import Action, Tracker
from rasa_sdk.executor import CollectingDispatcher
from rasa_sdk.events import SlotSet
import datetime

# ─── Risk Keywords ────────────────────────────────────────────────────────────
HIGH_RISK_KEYWORDS = [
    "suicide", "kill myself", "want to die", "end it all", "self harm",
    "hurt myself", "cut myself", "don't want to be here", "worthless",
    "hopeless", "no point", "give up", "disappear", "burden", "hate myself"
]

MEDIUM_RISK_KEYWORDS = [
    "sad", "depressed", "crying", "alone", "lonely", "empty", "numb",
    "lost", "anxious", "panic", "overwhelmed", "can't cope", "failing",
    "no one cares", "stressed", "exhausted", "burnt out"
]

# ─── Intent Risk Mapping ───────────────────────────────────────────────────────
INTENT_RISK_MAP = {
    "express_crisis": "high",
    "express_hopelessness": "high",
    "express_sadness": "medium",
    "express_anxiety": "medium",
    "express_stress": "medium",
    "ask_for_help": "medium",
    "greet": "low",
    "share_positive": "low",
    "small_talk": "low",
    "thank": "low",
    "goodbye": "low",
}


def assess_risk_level(message: str, intent: str) -> dict:
    """
    Assess emotional risk based on:
    - Presence of high/medium risk keywords
    - Detected intent
    - Time of message (night sessions = higher weight)
    Returns a risk dict with level and score.
    """
    message_lower = message.lower() if message else ""
    score = 0

    # Keyword scoring
    for kw in HIGH_RISK_KEYWORDS:
        if kw in message_lower:
            score += 3

    for kw in MEDIUM_RISK_KEYWORDS:
        if kw in message_lower:
            score += 1

    # Intent scoring
    intent_risk = INTENT_RISK_MAP.get(intent, "low")
    if intent_risk == "high":
        score += 3
    elif intent_risk == "medium":
        score += 1

    # Night session weight (11pm - 4am)
    current_hour = datetime.datetime.now().hour
    is_night = current_hour >= 23 or current_hour <= 4
    if is_night:
        score += 1

    # Determine level
    if score >= 4:
        level = "high"
    elif score >= 2:
        level = "medium"
    else:
        level = "low"

    return {
        "level": level,
        "score": score,
        "is_night": is_night,
        "keyword_detected": any(kw in message_lower for kw in HIGH_RISK_KEYWORDS)
    }


class ActionAssessRisk(Action):
    """Assess the emotional risk level of the current user message."""

    def name(self) -> Text:
        return "action_assess_risk"

    def run(
        self,
        dispatcher: CollectingDispatcher,
        tracker: Tracker,
        domain: Dict[Text, Any],
    ) -> List[Dict[Text, Any]]:

        latest_message = tracker.latest_message.get("text", "")
        intent = tracker.latest_message.get("intent", {}).get("name", "")

        risk_data = assess_risk_level(latest_message, intent)
        risk_level = risk_data["level"]

        return [SlotSet("risk_level", risk_level)]


class ActionSetRiskLevel(Action):
    """Utility action to manually set risk level."""

    def name(self) -> Text:
        return "action_set_risk_level"

    def run(
        self,
        dispatcher: CollectingDispatcher,
        tracker: Tracker,
        domain: Dict[Text, Any],
    ) -> List[Dict[Text, Any]]:

        risk_level = tracker.get_slot("risk_level") or "low"
        return [SlotSet("risk_level", risk_level)]
