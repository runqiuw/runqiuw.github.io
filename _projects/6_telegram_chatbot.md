---
layout: page
title: Telegram Chatbot with Message Summarization
description: A Telegram chatbot that can interact with users, maintain chat history, and provide summaries of past conversations.
img: assets/img/projects/chatbot-logo.png
redirect: https://github.com/runqiuw/context_chatbot_telegram
importance: 6
category: fun
github: https://github.com/runqiuw/context_chatbot_telegram
timeline: Jan 2024
labels: ["LLM"]
---

## Overview

A flexible Telegram chatbot that can interact with users, maintain chat history, and provide summaries of past conversations. The bot is designed to operate in either a local mode or via an API, depending on the configuration.

## Key Features

- **Chat History Management**: The bot keeps track of recent messages in a chat, allowing it to provide context-aware responses.
- **Message Summarization**: Users can request summaries of the last `n` messages, with options for both English and Chinese summaries.
- **Superchat Support**: The bot can handle messages in different threads within a Superchat, maintaining separate histories for each thread.
- **Customizable System Prompt**: The bot's behavior can be customized by modifying the system prompt in the configuration file.
- **Local and API Modes**: The bot can operate in two modes:
  - **API Mode (recommended)**: Connects to an external API that supports OpenAI API (e.g., DeepSeek) for generating responses.
  - **Local Mode**: Uses a local chatbot model (Qwen2.5-7B-Instruct) for generating responses.

## Usage

- **Start a Conversation**: Simply mention the bot in a message (e.g., `@yourbotname Hello!`), and it will respond.
- **Clear Chat History**: Use the `/new_chat` command to clear the chat history and start fresh.
- **Summarize Messages**: Use the `/summarize <number> <(optional)zh/en>` command to get a summary of the last `n` messages. You can specify the language (`zh` for Chinese, `en` for English) as an optional argument.
- **Help**: Use the `/help` command to get a list of available commands and their usage.

**GitHub:** [https://github.com/runqiuw/context_chatbot_telegram](https://github.com/runqiuw/context_chatbot_telegram)
