import React, { useState, useRef } from 'react';
import { uploadFile, mergeChunk } from '@/api/index.js';

const UploadPage = () => {
  const [uploadFileList, setUploadFileList] = useState([]);
  const [chunkSize] = useState(1 * 1024 * 1024); // 切片大小 1M
  const [maxRequest, setMaxRequest] = useState(6); // 最大并发数
  const fileInputRef = useRef(null);

  const handleClick = () => {
    fileInputRef.current.click(); // 触发文件选择
  };

  const handleUploadFile = async (e) => {
    const files = e.target.files;

    if (!files || files.length === 0) return;

    Array.from(files).forEach(async (item, i) => {
      const file = item;
      const inTaskArrItem = {
        id: new Date() + i,
        state: 0,
        fileHash: '',
        fileName: file.name,
        fileSize: file.size,
        allChunkList: [],  // 所有请求的数据
        whileRequests: [], // 正在请求中的请求个数,目前是要永远都保存请求个数为6
        finishNumber: 0,  //请求完成的个数
        errNumber: 0,  // 报错的个数,默认是0个,超多3个就是直接上传中断
        percentage: 0, // 单个文件上传进度条
      };

      setUploadFileList((prevList) => [...prevList, inTaskArrItem]);

      inTaskArrItem.state = 1; // 解析中

      if (file.size === 0) {
        // 文件为空， 跳过
        setUploadFileList((prevList) => prevList.filter((_, idx) => idx !== i));
        return;
      }

      const { fileHash, fileChunkList } = await useWorker(file);
      console.log(fileHash, '文件hash计算完成');

      const baseName = file.name.slice(0, file.name.lastIndexOf('.')) || file.name;

      inTaskArrItem.fileHash = `${fileHash}${baseName}`;
      inTaskArrItem.state = 2;

      inTaskArrItem.allChunkList = fileChunkList.map((item, index) => ({
        fileHash: `${fileHash}${baseName}`,
        fileSize: file.size,
        fileName: file.name,
        index,
        chunkFile: item.chunkFile,
        chunkHash: `${fileHash}-${index}`,
        chunkSize: chunkSize,
        chunkNumber: fileChunkList.length,
        finish: false,
      }));

      uploadSingleFile(inTaskArrItem);
    });
  };

  const useWorker = (file) => {
    return new Promise((resolve) => {
      const worker = new Worker(new URL('./worker/', import.meta.url), {
      });
      worker.postMessage({ file, chunkSize });
      worker.onmessage = (e) => {
        const { fileHash, fileChunkList } = e.data;
        resolve({ fileHash, fileChunkList });
      };
    });
  };

  const uploadSingleFile = (taskArrItem) => {
    if (taskArrItem.allChunkList.length === 0 || taskArrItem.whileRequests.length > 0) {
      return;
    }

    const isTaskArrIng = uploadFileList.filter((itemB) => itemB.state === 1 || itemB.state === 2);
    const dynamicMaxRequest = Math.ceil(6 / isTaskArrIng.length);
    setMaxRequest(dynamicMaxRequest);

    const whileRequest = taskArrItem.allChunkList.slice(-dynamicMaxRequest);
    taskArrItem.whileRequests.push(...whileRequest);

    if (taskArrItem.allChunkList.length > dynamicMaxRequest) {
      taskArrItem.allChunkList.splice(-dynamicMaxRequest);
    } else {
      taskArrItem.allChunkList = [];
    }

    const uploadChunk = async (needObj) => {
      const fd = new FormData();
      const {
        fileHash, fileSize, fileName, index, chunkFile, chunkHash, chunkSize, chunkNumber
      } = needObj;

      fd.append('fileHash', fileHash);
      fd.append('fileSize', String(fileSize));
      fd.append('fileName', fileName);
      fd.append('index', String(index));
      fd.append('chunkFile', chunkFile);
      fd.append('chunkHash', chunkHash);
      fd.append('chunkSize', String(chunkSize));
      fd.append('chunkNumber', String(chunkNumber));

      const res = await uploadFile(fd).catch(() => {});

      if (taskArrItem.state === 5) return;

      if (!res || res.code === -1) {
        taskArrItem.errNumber++;
        if (taskArrItem.errNumber > 3) {
          taskArrItem.state = 4;
        } else {
          uploadChunk(needObj);
        }
      } else if (res.code === 0) {
        taskArrItem.errNumber = Math.max(0, taskArrItem.errNumber - 1);
        taskArrItem.finishNumber++;
        needObj.finish = true;
        updateProgress(needObj, taskArrItem);
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

    whileRequest.forEach((item) => uploadChunk(item));
  };

  const handleMerge = async (taskArrItem) => {
    const { fileName, fileHash } = taskArrItem;
    const res = await mergeChunk({ chunkSize, fileName, fileHash }).catch(() => {});
    if (res && res.code === 0) {
      finishTask(taskArrItem);
    } else {
      taskArrItem.state = 4;
    }
    taskArrItem.finishNumber = 0;
  };

  const updateProgress = (needObj, taskArrItem) => {
    taskArrItem.percentage = Number(
      ((taskArrItem.finishNumber / needObj.chunkNumber) * 100).toFixed(2)
    );
  };

  const finishTask = (item) => {
    item.state = 3;
    item.percentage = 100;
  };

  const cancelUpload = (item) => {
    item.state = 5;
    setUploadFileList((prevList) => prevList.filter((file) => file.fileHash !== item.fileHash));
  };

  return (
    <div>
      <div className="upload-drag" onClick={handleClick}>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleUploadFile}
          accept=""
          multiple={false}
          style={{ display: 'none' }}
        />
        <div>
          <i className="el-icon-upload" style={{ fontSize: '50px', color: '#c0c4cc' }}></i>
        </div>
      </div>

      {uploadFileList.map((item) => (
        <div key={item.id} style={{ display: 'flex', marginTop: '10px' }}>
          <div style={{ width: '300px' }}>
            <div>
              <progress value={item.percentage} max="100" style={{ width: '100%' }}></progress>
              <div style={{ marginLeft: '4px' }}>
                {item.state === 1 && <p>正在解析中...</p>}
                {item.state === 2 && <p>正在上传中...</p>}
                {item.state === 3 && <p>上传完成</p>}
                {item.state === 4 && <p>上传失败</p>}
              </div>
            </div>
          </div>
          {![0, 1].includes(item.state) && (
            <button onClick={() => cancelUpload(item)} style={{ marginLeft: '10px', height: '40px' }}>
              取消
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default UploadPage;
