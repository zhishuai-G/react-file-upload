import { useRef, useState } from 'react'
import { Progress, Button } from 'antd';
import { uploadFile, mergeChunk } from './api/index.js';
import './App.css'

function App() {
  const [uploadFileList, setUploadFileList] = useState([]);
  const [maxRequest, setMaxRequest] = useState(6); // 请求最大并发数
  const chunkSize = 1 * 1024 * 1024; // 切片大小1M

  const handleUploadFile = async (event) => {
    const files = event.target.files;

    // 如果没有文件内容
    if (!files || files.length === 0) {
      return false;
    }

    Array.from(files).forEach(async (file, i) => {
      const inTaskArrItem = {
        id: `${new Date()}_${i}`, // 因为forEach是同步，所以需要用指定id作为唯一标识
        state: 0, // 0不做任何处理，1是计算hash中，2是正在上传中，3是上传完成，4是上传失败，5是上传取消
        fileHash: '',
        fileName: file.name,
        fileSize: file.size,
        allChunkList: [], // 所有请求的数据
        whileRequests: [], // 正在请求中的请求个数，目前要永远都保存请求个数为6
        finishNumber: 0, // 请求完成的个数
        errNumber: 0, // 报错的个数，默认是0个，超过3个则直接上传中断
        percentage: 0, // 单个文件上传进度条
      };

      setUploadFileList((prevList) => [...prevList, inTaskArrItem]);

      // 开始处理解析文件
      updateTaskState(inTaskArrItem.id, 1); // 1 表示正在计算 hash

      if (file.size === 0) {
        // 文件大小为0直接取消该文件上传
        setUploadFileList((prevList) =>
          prevList.filter((_, index) => index !== i)
        );
        return;
      }

      // 计算文件hash
      const { fileHash, fileChunkList } = await useWorker(file);
      console.log(fileHash, '文件hash计算完成');

      let baseName = '';
      const lastIndex = file.name.lastIndexOf('.');
      baseName = lastIndex === -1 ? file.name : file.name.slice(0, lastIndex);

      inTaskArrItem.fileHash = `${fileHash}${baseName}`;
      // 计算文件 hash 完成后，状态更新为正在上传
      updateTaskState(inTaskArrItem.id, 2); // 2 表示正在上传

      inTaskArrItem.allChunkList = fileChunkList.map((chunk, index) => ({
        fileHash: `${fileHash}${baseName}`,
        fileSize: file.size,
        fileName: file.name,
        index,
        chunkFile: chunk.chunkFile,
        chunkHash: `${fileHash}-${index}`,
        chunkSize,
        chunkNumber: fileChunkList.length,
        finish: false,
      }));

      uploadSingleFile(inTaskArrItem);
    });
  };

  const useWorker = (file) => {
    return new Promise((resolve) => {
      const worker = new Worker('/worker/hash-worker.js');
      worker.postMessage({ file, chunkSize });
      worker.onmessage = (e) => {
        const { fileHash, fileChunkList } = e.data;
        if (fileHash) {
          resolve({ fileHash, fileChunkList });
        }
      };
    });
  };

  const uploadSingleFile = (taskArrItem) => {
    if (taskArrItem.allChunkList.length === 0 || taskArrItem.whileRequests.length > 0) {
      return false;
    }

    const isTaskArrIng = uploadFileList.filter((item) => item.state === 1 || item.state === 2);
    const maxReq = Math.ceil(6 / isTaskArrIng.length);
    setMaxRequest(maxReq);

    let whileRequest = taskArrItem.allChunkList.slice(-maxReq);
    taskArrItem.whileRequests.push(...whileRequest);

    if (taskArrItem.allChunkList.length > maxReq) {
      taskArrItem.allChunkList.splice(-maxReq);
    } else {
      taskArrItem.allChunkList = [];
    }

    whileRequest.forEach((item) => {
      uploadChunk(item, taskArrItem);
    });
  };

  const uploadChunk = async (needObj, taskArrItem) => {
    const fd = new FormData();
    const {
      fileHash,
      fileSize,
      fileName,
      index,
      chunkFile,
      chunkHash,
      chunkSize,
      chunkNumber,
    } = needObj;

    fd.append('fileHash', fileHash);
    fd.append('fileSize', String(fileSize));
    fd.append('fileName', fileName);
    fd.append('index', String(index));
    fd.append('chunkFile', chunkFile);
    fd.append('chunkHash', chunkHash);
    fd.append('chunkSize', String(chunkSize));
    fd.append('chunkNumber', String(chunkNumber));

    const res = await uploadFile(fd).catch(() => { });

    if (taskArrItem.state === 5) {
      return false;
    }

    if (!res || res.code === -1) {
      taskArrItem.errNumber++;
      if (taskArrItem.errNumber > 3) {
        console.log('切片上传失败超过三次了');
        updateTaskState(taskArrItem.id, 4);
      } else {
        console.log('切片上传失败还没超过3次');
        uploadChunk(needObj, taskArrItem);
      }
    } else if (res.code === 0) {
      taskArrItem.errNumber > 0 ? taskArrItem.errNumber-- : 0;
      taskArrItem.finishNumber++;
      needObj.finish = true;

      singleFileProgress(needObj, taskArrItem);

      taskArrItem.whileRequests = taskArrItem.whileRequests.filter(
        (item) => item.chunkFile !== needObj.chunkFile
      );

      if (taskArrItem.finishNumber === chunkNumber) {
        handleMerge(taskArrItem);
      } else {
        uploadSingleFile(taskArrItem);
      }
    }
  };

  const handleMerge = async (taskArrItem) => {
    const { fileName, fileHash } = taskArrItem;
    const res = await mergeChunk({ chunkSize, fileName, fileHash }).catch(() => { });

    if (res && res.code === 0) {
      finishTask(taskArrItem);
      console.log('文件合并成功！');
    } else {
      updateTaskState(taskArrItem.id, 4);
      console.log('文件合并失败！');
    }

    taskArrItem.finishNumber = 0;
  };

  // 修改任务的状态
  const updateTaskState = (taskId, newState) => {
    setUploadFileList((prevList) =>
      prevList.map((task) =>
        task.id === taskId
          ? { ...task, state: newState }
          : task
      )
    );
  };

  const singleFileProgress = (needObj, taskArrItem) => {
    // 计算新的进度
    const newPercentage = Number(
      ((taskArrItem.finishNumber / needObj.chunkNumber) * 100).toFixed(2)
    );

    // 更新任务进度
    setUploadFileList((prevList) =>
      prevList.map((task) =>
        task.id === taskArrItem.id
          ? { ...task, percentage: newPercentage }
          : task
      )
    );
  };

  const finishTask = (item) => {
    updateTaskState(item.id, 3);
    item.percentage = 100;
  };

  const cancelUpload = (item) => {
    updateTaskState(item.id, 5);
    setUploadFileList((prevList) =>
      prevList.filter((task) => task.fileHash !== item.fileHash)
    );
  };

  return (
    <>
      <div>
        <input
          type="file"
          onChange={handleUploadFile}
          multiple={false}
        />
      </div>
      {
        uploadFileList.map((item, index) => (
          <div key={item.id} style={{ display: 'flex', marginTop: '10px' }}>
            <div style={{ width: '300px' }}>
              <div>
                <Progress percent={item?.percentage} style={{ width: '100%' }}></Progress>
                <div style={{ marginLeft: '4px' }}>
                  {item.state === 1 && <p>正在解析中...</p>}
                  {item.state === 2 && <p>正在上传中...</p>}
                  {item.state === 3 && <p>上传完成</p>}
                  {item.state === 4 && <p>上传失败</p>}
                </div>
              </div>
            </div>
            {![0, 1].includes(item.state) && (
              <Button color="danger" variant="solid" style={{ marginLeft: '10px', height: '40px' }}>取消</Button>
            )}
          </div>
        ))
      }
    </>
  )
}

export default App
