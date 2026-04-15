import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

async function listModels() {
  try {
    const modelList = await genai.listModels();
    console.log(JSON.stringify(modelList, null, 2));
  } catch (err) {
    console.error("Error listing models:", err);
  }
}

listModels();
